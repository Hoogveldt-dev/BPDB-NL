// Test van alle migraties en de spelregels in een Postgres in het geheugen (PGlite met PostGIS),
// zonder Supabase-project. Draaien: npm run test:db
// Wat Supabase zelf regelt (rollen, auth.users, auth.uid(), opslag) wordt hieronder nagebootst.
import { PGlite } from '@electric-sql/pglite';
import { postgis } from '@electric-sql/pglite-postgis';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAP = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const db = new PGlite({ extensions: { postgis } });

let ok = 0, fout = 0;
const check = (naam, voorwaarde, extra = '') => {
  if (voorwaarde) { ok++; console.log('  ok  ', naam); } else { fout++; console.log('  FOUT', naam, extra); }
};

// Voer een query uit als een ingelogde speler (of anoniem met wie = null)
const als = async (wie, q, params) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${wie ?? ''}', false); set role ${wie ? 'authenticated' : 'anon'};`);
  try { return { rows: (await db.query(q, params)).rows }; } catch (e) { return { fout: e.message }; } finally { await db.exec('reset role'); }
};
const een = async (q, params) => (await db.query(q, params)).rows[0];

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema extensions;
  grant usage on schema public, extensions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}',
    is_anonymous boolean not null default false);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  create schema storage;
  grant usage on schema storage to anon, authenticated, service_role;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant select, insert, delete on storage.objects to authenticated;
  create function storage.foldername(name text) returns text[] language sql immutable
    as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  grant execute on function storage.foldername(text) to authenticated;

  create publication supabase_realtime;
`);

for (const f of readdirSync(MAP).filter((f) => f.endsWith('.sql')).sort()) {
  try {
    await db.exec(readFileSync(join(MAP, f), 'utf8'));
  } catch (e) {
    console.log('FOUT in migratie', f, e.message);
    process.exit(1);
  }
}
console.log('migraties uitgevoerd');

// ---------------------------------------------------------------------------
// Spelers en profielen
// ---------------------------------------------------------------------------

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const C = '33333333-3333-3333-3333-333333333333';
const D = '44444444-4444-4444-4444-444444444444';
const E = '55555555-5555-5555-5555-555555555555';
await db.exec(`
  insert into auth.users (id, email, raw_user_meta_data) values
    ('${A}', 'anna@example.nl', '{"naam": "Anna"}'),
    ('${B}', 'bram@example.nl', '{"naam": "Bram"}'),
    ('${C}', 'carla@example.nl', '{"naam": "anna"}'),
    ('${D}', 'dirk@example.nl', '{"naam": "<b>Dirk</b>"}'),
    ('${E}', 'eva@example.nl', '{"naam": "Eva"}');
`);
const namen = Object.fromEntries((await db.query('select id, naam from public.profielen')).rows.map((r) => [r.id, r.naam]));
check('profiel aangemaakt bij nieuwe gebruiker', namen[A] === 'Anna', JSON.stringify(namen));
check('dubbele naam krijgt een nummer', namen[C] === 'anna2', namen[C]);
check('tekens als < en > gaan uit de naam', namen[D] === 'bDirkb', namen[D]);

const r1 = await als(A, `update public.profielen set naam = 'Anna B' where id = '${A}' returning naam`);
check('eigen naam aanpassen', r1.rows?.[0]?.naam === 'Anna B', JSON.stringify(r1));
const r2 = await als(A, `update public.profielen set naam = 'Gekaapt' where id = '${B}' returning naam`);
check('naam van een ander aanpassen kan niet', r2.rows?.length === 0, JSON.stringify(r2));
const r3 = await als(A, `update public.profielen set betrouwbaarheid = 100 where id = '${A}'`);
check('eigen betrouwbaarheid aanpassen kan niet', !!r3.fout, JSON.stringify(r3));
const r4 = await als(A, `update public.profielen set is_beheerder = true where id = '${A}'`);
check('jezelf beheerder maken kan niet', !!r4.fout, JSON.stringify(r4));
const r5 = await als(B, `update public.profielen set naam = 'anna b' where id = '${B}'`);
check('naam die al bezet is (andere hoofdletters) kan niet', /profielen_naam_uniek|duplicate/.test(r5.fout ?? ''), JSON.stringify(r5));

// ---------------------------------------------------------------------------
// Kroegen en wijken importeren (alleen service_role)
// ---------------------------------------------------------------------------

const kroegenJson = JSON.stringify([
  { osm_id: 'node/1', naam: 'De Blaauwe Hand', soort: 'pub', lat: 51.8475, lon: 5.8640 },
  { osm_id: 'node/2', naam: 'Café Kroeg Twee', soort: 'bar', lat: 51.8450, lon: 5.8650 },
  { osm_id: 'node/3', naam: 'Café Drie', soort: 'pub', lat: 51.8430, lon: 5.8660 },
  { osm_id: 'node/4', naam: 'Café Vier', soort: 'pub', lat: 51.8420, lon: 5.8670 },
  { osm_id: 'node/5', naam: 'Café Vijf', soort: 'pub', lat: 51.8410, lon: 5.8680 },
  { osm_id: 'node/6', naam: 'Café Zes', soort: 'pub', lat: 51.8400, lon: 5.8690 },
  { osm_id: 'node/7', naam: 'Café Zeven', soort: 'pub', lat: 51.8390, lon: 5.8700 },
  { osm_id: 'node/8', naam: 'Gesloten Café', soort: 'pub', lat: 51.8380, lon: 5.8710 },
  { osm_id: 'node/9', naam: '', soort: 'pub', lat: 51.8370, lon: 5.8720 },
]);
const r6 = await als(A, `select public.importeer_kroegen($1::jsonb, 'Nijmegen')`, [kroegenJson]);
check('speler kan geen kroegen importeren', /permission denied/.test(r6.fout ?? ''), JSON.stringify(r6));
await db.exec('set role service_role');
const aantal = (await db.query(`select public.importeer_kroegen($1::jsonb, 'Nijmegen') as n`, [kroegenJson])).rows[0].n;
await db.exec('reset role');
check('import slaat kroegen zonder naam over', aantal === 8, String(aantal));

const wijkJson = JSON.stringify({
  features: [{
    properties: { wijkcode: 'WK026800', wijknaam: 'Stadscentrum', gemeentenaam: 'Nijmegen' },
    geometry: { type: 'Polygon', coordinates: [[[5.85, 51.835], [5.88, 51.835], [5.88, 51.85], [5.85, 51.85], [5.85, 51.835]]] },
  }],
});
await db.exec('set role service_role');
await db.query(`select public.importeer_wijken($1::jsonb)`, [wijkJson]);
// Een tweede import zonder node/8 sluit die kroeg, maar verwijdert hem niet
await db.query(`select public.importeer_kroegen($1::jsonb, 'Nijmegen')`, [JSON.stringify(JSON.parse(kroegenJson).filter((k) => k.osm_id !== 'node/8'))]);
await db.exec('reset role');
const wijk = await een(`select count(*)::int as n from public.kroegen where wijk_id is not null`);
check('kroegen gekoppeld aan hun wijk', wijk.n === 8, JSON.stringify(wijk));
const dicht = await een(`select open from public.kroegen where osm_id = 'node/8'`);
check('kroeg die uit OSM verdwijnt gaat dicht en blijft bestaan', dicht?.open === false, JSON.stringify(dicht));

const id = async (osm) => (await een(`select id from public.kroegen where osm_id = $1`, [osm])).id;
const K1 = await id('node/1'), K2 = await id('node/2'), K3 = await id('node/3');

// ---------------------------------------------------------------------------
// Lezen en schrijven
// ---------------------------------------------------------------------------

const r7 = await als(null, `select naam, versheid from public.kroeg_kaart where id = ${K1}`);
check('anoniem kan de kaart lezen', r7.rows?.[0]?.versheid === 'locked', JSON.stringify(r7));
const r8 = await als(A, `insert into public.gebeurtenissen (kroeg_id, soort, merk, volume_cl, prijs_cent, door_id, status)
  values (${K1}, 'eerst', 'Heineken', 25, 300, '${A}', 'bevestigd')`);
check('speler kan niet direct een melding schrijven', /permission denied/.test(r8.fout ?? ''), JSON.stringify(r8));
const r9 = await als(A, `insert into public.punten (gebruiker_id, reden, punten) values ('${A}', 'vals', 1000)`);
check('speler kan zichzelf geen punten geven', /permission denied/.test(r9.fout ?? ''), JSON.stringify(r9));
const r10 = await als(A, `update public.kroeg_kaart set huidig_prijs_cent = 100 where id = ${K1}`);
check('speler kan niet via een overzicht schrijven', !!r10.fout, JSON.stringify(r10));
const r11 = await als(null, `select public.meld_prijs(${K1}, 'Heineken', 25, 300)`);
check('anoniem kan geen prijs melden', !!r11.fout, JSON.stringify(r11));

// ---------------------------------------------------------------------------
// Vrijspelen en bevestigen
// ---------------------------------------------------------------------------

// Anna staat bij De Blaauwe Hand (binnen 75 m) en meldt de eerste prijs
const m1 = await als(A, `select * from public.meld_prijs(${K1}, 'Heineken', 25, 320, 51.8476, 5.8641)`);
const g1 = m1.rows?.[0];
check('eerste prijs melden', g1?.soort === 'eerst' && g1?.status === 'wacht', JSON.stringify(m1));
check('ter plaatse binnen 75 m', g1?.ter_plaatse === true && g1?.afstand_m < 75, JSON.stringify(g1));
const k1 = await een(`select ontdekker_id, huidig_prijs_cent from public.kroegen where id = ${K1}`);
check('kroeg is vrijgespeeld, prijs nog niet bevestigd', k1.ontdekker_id === A && k1.huidig_prijs_cent === null, JSON.stringify(k1));
const r12 = await als(B, `select * from public.meld_prijs(${K1}, 'Amstel', 25, 330)`);
check('tweede open melding voor dezelfde kroeg kan niet', /al een melding open/.test(r12.fout ?? ''), JSON.stringify(r12));
const r13 = await als(A, `select public.beoordeel(${g1.id}, 'klopt')`);
check('eigen melding beoordelen kan niet', /eigen melding/.test(r13.fout ?? ''), JSON.stringify(r13));
const r14 = await als(B, `select public.beoordeel(${g1.id}, 'klopt') as s`);
check('bevestigd door een ander', r14.rows?.[0]?.s === 'bevestigd', JSON.stringify(r14));
const r15 = await als(C, `select public.beoordeel(${g1.id}, 'klopt')`);
check('afgeronde melding beoordelen kan niet', /al afgerond/.test(r15.fout ?? ''), JSON.stringify(r15));
const k1b = await een(`select huidig_prijs_cent, huidig_merk from public.kroegen where id = ${K1}`);
check('bevestigde prijs staat op de kroeg', k1b.huidig_prijs_cent === 320 && k1b.huidig_merk === 'Heineken', JSON.stringify(k1b));
const pA = await een(`select altijd, betrouwbaarheid::float as b from public.ranglijst where id = '${A}'`);
check('vrijspelen ter plaatse: 50 x 1,5 = 75 punten', pA.altijd === 75, JSON.stringify(pA));
check('betrouwbaarheid melder +2', pA.b === 52, JSON.stringify(pA));
const pB = await een(`select altijd, betrouwbaarheid::float as b from public.ranglijst where id = '${B}'`);
check('bevestigen: 5 punten en betrouwbaarheid +1', pB.altijd === 5 && pB.b === 51, JSON.stringify(pB));

// Prijswijziging met foto in de eigen map
const m2 = await als(B, `select * from public.meld_prijs(${K1}, 'Heineken', 25, 340, null, null, '${A}/lijst.jpg')`);
check('foto in de map van een ander kan niet', /hoort niet bij jou/.test(m2.fout ?? ''), JSON.stringify(m2));
const m3 = await als(B, `select * from public.meld_prijs(${K1}, 'Heineken', 25, 320)`);
check('dezelfde prijs nog eens melden kan niet', /staat er al/.test(m3.fout ?? ''), JSON.stringify(m3));
const m4 = await als(B, `select * from public.meld_prijs(${K1}, 'Heineken', 25, 340, null, null, '${B}/lijst.jpg')`);
const g4 = m4.rows?.[0];
check('prijswijziging melden', g4?.soort === 'wijziging' && g4?.vorige_prijs_cent === 320, JSON.stringify(m4));
await als(C, `select public.beoordeel(${g4.id}, 'klopt')`);
const pB2 = await een(`select altijd from public.ranglijst where id = '${B}'`);
check('prijswijziging 30 + foto 5 punten', pB2.altijd === 5 + 30 + 5, JSON.stringify(pB2));

// ---------------------------------------------------------------------------
// Weerleggen
// ---------------------------------------------------------------------------

const m5 = await als(E, `select * from public.meld_prijs(${K2}, 'Brand', 25, 290)`);
const g5 = m5.rows?.[0];
const r16 = await als(A, `select public.beoordeel(${g5.id}, 'klopt_niet') as s`);
check('een keer "klopt niet" is nog niet genoeg', r16.rows?.[0]?.s === 'wacht', JSON.stringify(r16));
const r17 = await als(A, `select public.beoordeel(${g5.id}, 'klopt_niet')`);
check('twee keer beoordelen door dezelfde speler kan niet', /al beoordeeld/.test(r17.fout ?? ''), JSON.stringify(r17));
const r18 = await als(B, `select public.beoordeel(${g5.id}, 'klopt_niet') as s`);
check('twee keer "klopt niet": weerlegd', r18.rows?.[0]?.s === 'weerlegd', JSON.stringify(r18));
const k2 = await een(`select ontdekker_id from public.kroegen where id = ${K2}`);
check('weerlegde eerste prijs: kroeg weer onder de mist', k2.ontdekker_id === null, JSON.stringify(k2));
const pE = await een(`select altijd, betrouwbaarheid::float as b from public.ranglijst where id = '${E}'`);
check('weerlegd: -20 punten en betrouwbaarheid -10', pE.altijd === -20 && pE.b === 40, JSON.stringify(pE));

// ---------------------------------------------------------------------------
// Klopt nog
// ---------------------------------------------------------------------------

const r19 = await als(C, `select * from public.klopt_nog(${K3})`);
check('klopt nog zonder bevestigde prijs kan niet', /nog geen bevestigde prijs/.test(r19.fout ?? ''), JSON.stringify(r19));
const voorC = (await een(`select altijd from public.ranglijst where id = '${C}'`)).altijd;
const r20 = await als(C, `select * from public.klopt_nog(${K1})`);
check('klopt nog', r20.rows?.[0]?.soort === 'check' && r20.rows?.[0]?.status === 'bevestigd', JSON.stringify(r20));
const naC = (await een(`select altijd from public.ranglijst where id = '${C}'`)).altijd;
check('klopt nog: 5 punten', naC - voorC === 5, `${voorC} -> ${naC}`);
const r21 = await als(C, `select * from public.klopt_nog(${K1})`);
check('klopt nog hoogstens een keer per week', /deze week al/.test(r21.fout ?? ''), JSON.stringify(r21));
// Een prijs die al 90 dagen niet is gecontroleerd levert 15 punten op
await db.exec(`update public.kroegen set laatst_gecontroleerd = now() - interval '100 days', prijs_sinds = now() - interval '100 days' where id = ${K1}`);
const r22 = await als(D, `select * from public.klopt_nog(${K1})`);
const pD = await een(`select altijd from public.ranglijst where id = '${D}'`);
check('oude prijs controleren: 15 punten', !r22.fout && pD.altijd === 15, JSON.stringify({ r22, pD }));

// ---------------------------------------------------------------------------
// Uitschieters en betrouwbare melders
// ---------------------------------------------------------------------------

// Vijf bevestigde prijzen rond € 3,20 per 25 cl in de stad
await db.exec(`update public.kroegen set huidig_merk = 'Heineken', huidig_volume_cl = 25, huidig_prijs_cent = 320,
  ontdekker_id = '${A}', ontdekt_op = now(), laatst_gecontroleerd = now()
  where osm_id in ('node/3', 'node/4', 'node/5', 'node/6')`);
const K7 = await id('node/7');
const m6 = await als(A, `select * from public.meld_prijs(${K7}, 'Heineken', 25, 900)`);
const g6 = m6.rows?.[0];
check('prijs ver boven de mediaan is een uitschieter', g6?.uitschieter === true, JSON.stringify(m6));
const r23 = await als(B, `select public.beoordeel(${g6.id}, 'klopt') as s`);
check('uitschieter: een bevestiging is niet genoeg', r23.rows?.[0]?.s === 'wacht', JSON.stringify(r23));
const r24 = await als(C, `select public.beoordeel(${g6.id}, 'klopt') as s`);
check('uitschieter: twee bevestigingen van anderen', r24.rows?.[0]?.s === 'bevestigd', JSON.stringify(r24));

await db.exec(`update public.profielen set betrouwbaarheid = 95 where id = '${D}'`);
const m7 = await als(D, `select * from public.meld_prijs(${K3}, 'Heineken', 25, 330)`);
check('melder boven 90% is direct bevestigd', m7.rows?.[0]?.status === 'bevestigd', JSON.stringify(m7));

// ---------------------------------------------------------------------------
// Kroegen in de buurt en opslag van foto's
// ---------------------------------------------------------------------------

const r25 = await als(null, `select naam, afstand_m from public.kroegen_in_de_buurt(51.8476, 5.8641, 500)`);
check('kroegen in de buurt, dichtstbijzijnde eerst', r25.rows?.[0]?.naam === 'De Blaauwe Hand' && r25.rows[0].afstand_m < 20, JSON.stringify(r25));
check('gesloten kroeg niet in de buurt', !r25.rows?.some((r) => r.naam === 'Gesloten Café'), JSON.stringify(r25.rows));

const r26 = await als(A, `insert into storage.objects (bucket_id, name) values ('prijslijsten', '${A}/foto.jpg')`);
check('foto uploaden in eigen map', !r26.fout, JSON.stringify(r26));
const r27 = await als(A, `insert into storage.objects (bucket_id, name) values ('prijslijsten', '${B}/foto.jpg')`);
check('foto uploaden in de map van een ander kan niet', /row-level security/.test(r27.fout ?? ''), JSON.stringify(r27));

// ---------------------------------------------------------------------------
// Anonieme spelers (zonder e-mailadres)
// ---------------------------------------------------------------------------

const Z = '66666666-6666-6666-6666-666666666666';
const Y = '77777777-7777-7777-7777-777777777777';
const F = '88888888-8888-8888-8888-888888888888';
await db.exec(`
  insert into auth.users (id, email, raw_user_meta_data, is_anonymous) values
    ('${Z}', null, '{"naam": "Zoë"}', true),
    ('${Y}', null, '{}', true),
    ('${F}', 'frank.de.vries@example.nl', '{}', false);
`);
const nZ = await een(`select naam from public.profielen where id = '${Z}'`);
check('anonieme speler krijgt profiel met eigen naam', nZ?.naam === 'Zoë', JSON.stringify(nZ));
const nY = await een(`select naam from public.profielen where id = '${Y}'`);
check('anonieme speler zonder naam heet speler', nY?.naam === 'speler', JSON.stringify(nY));
const nF = await een(`select naam from public.profielen where id = '${F}'`);
check('naam is nooit een stuk van het e-mailadres', nF?.naam === 'speler2', JSON.stringify(nF));

const K4 = await id('node/4');
const a1 = await als(Z, `select * from public.meld_prijs(${K4}, 'Heineken', 25, 330)`);
const ga = a1.rows?.[0];
check('anonieme speler kan een prijs melden', ga?.status === 'wacht', JSON.stringify(a1));
const a2 = await als(Y, `select public.beoordeel(${ga.id}, 'klopt')`);
check('anonieme speler kan niet bevestigen', /Koppel eerst je e-mailadres/.test(a2.fout ?? ''), JSON.stringify(a2));
const a3 = await als(Y, `select public.beoordeel(${ga.id}, 'klopt_niet')`);
check('anonieme speler kan niet weerleggen', /Koppel eerst je e-mailadres/.test(a3.fout ?? ''), JSON.stringify(a3));
const a4 = await als(A, `select public.beoordeel(${ga.id}, 'klopt') as s`);
check('speler met e-mail bevestigt melding van anonieme speler', a4.rows?.[0]?.s === 'bevestigd', JSON.stringify(a4));
const pZ = await een(`select altijd from public.ranglijst where id = '${Z}'`);
check('anonieme speler krijgt punten na bevestiging', pZ.altijd === 30, JSON.stringify(pZ));
const a5 = await als(Z, `select * from public.klopt_nog(${K1})`);
check('anonieme speler kan geen klopt nog doen', /Koppel eerst je e-mailadres/.test(a5.fout ?? ''), JSON.stringify(a5));

// Ook boven 90% betrouwbaarheid wordt een anonieme melder niet direct bevestigd
await db.exec(`update public.profielen set betrouwbaarheid = 95 where id = '${Z}'`);
const K5 = await id('node/5');
const a6 = await als(Z, `select * from public.meld_prijs(${K5}, 'Heineken', 25, 330)`);
check('anonieme melder boven 90% wacht toch op bevestiging', a6.rows?.[0]?.status === 'wacht', JSON.stringify(a6));

// E-mailadres gekoppeld: hetzelfde account, met punten, mag nu wel bevestigen
await db.exec(`update auth.users set is_anonymous = false, email = 'zoe@example.nl' where id = '${Z}'`);
const pZ2 = await een(`select naam, altijd from public.ranglijst where id = '${Z}'`);
check('na koppelen blijven naam en punten behouden', pZ2.naam === 'Zoë' && pZ2.altijd === 30, JSON.stringify(pZ2));
const a7 = await als(Z, `select * from public.klopt_nog(${K3})`);
check('na koppelen kan de speler klopt nog doen', !a7.fout, JSON.stringify(a7));
const a8 = await als(Z, `select public.vereis_email()`);
check('hulpfunctie is niet aan te roepen via de API', !!a8.fout, JSON.stringify(a8));

// ---------------------------------------------------------------------------

console.log(`\n${ok} goed, ${fout} fout`);
process.exit(fout ? 1 : 0);
