// Test van alle migraties en de spelregels in een Postgres in het geheugen (PGlite met PostGIS),
// zonder Supabase-project. Draaien: npm run test:db
// Wat Supabase zelf regelt (rollen, auth.users, auth.uid(), opslag) wordt hieronder nagebootst.
import { PGlite } from '@electric-sql/pglite';
import { postgis } from '@electric-sql/pglite-postgis';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAP = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const db = new PGlite({ extensions: { postgis, pg_trgm } });

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
// Laat elk van de spelers "klopt" zeggen op een melding en geef de status na het laatste oordeel terug
const klopt = async (gid, ...spelers) => {
  let s;
  for (const wie of spelers) s = (await als(wie, `select public.beoordeel(${gid}, 'klopt') as s`)).rows?.[0]?.s;
  return s;
};

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

// Spelersnaam: een zelfgekozen naam staat vast, een automatische naam mag je een keer veranderen
const N = '99999999-9999-9999-9999-999999999999';
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${N}', 'nina@example.nl', '{}')`);
const n0 = await een(`select naam, naam_vast from public.profielen where id = '${N}'`);
check('speler zonder gekozen naam heet speler en mag nog kiezen', n0?.naam === 'speler' && n0.naam_vast === false, JSON.stringify(n0));
const nv = await een(`select naam_vast from public.profielen where id = '${A}'`);
check('zelfgekozen naam bij aanmelden staat vast', nv?.naam_vast === true, JSON.stringify(nv));
const r1 = await als(A, `update public.profielen set naam = 'Anna B' where id = '${A}' returning naam`);
check('vaste naam wijzigen kan niet', /staat vast/.test(r1.fout ?? ''), JSON.stringify(r1));
const r5 = await als(N, `update public.profielen set naam = 'anna' where id = '${N}'`);
check('naam die al bezet is (andere hoofdletters) kan niet', /profielen_naam_uniek|duplicate/.test(r5.fout ?? ''), JSON.stringify(r5));
const n2 = await als(N, `update public.profielen set naam = 'Nina' where id = '${N}' returning naam, naam_vast`);
check('automatische naam een keer zelf kiezen', n2.rows?.[0]?.naam === 'Nina' && n2.rows[0].naam_vast === true, JSON.stringify(n2));
const n3 = await als(N, `update public.profielen set naam = 'Nina2' where id = '${N}'`);
check('daarna staat de naam vast', /staat vast/.test(n3.fout ?? ''), JSON.stringify(n3));
await db.exec(`update public.profielen set naam = 'Nina B' where id = '${N}'`);
const n4 = await een(`select naam from public.profielen where id = '${N}'`);
check('beheerder kan in de SQL-editor een naam wijzigen', n4?.naam === 'Nina B', JSON.stringify(n4));
const r2 = await als(B, `update public.profielen set naam = 'Gekaapt' where id = '${N}' returning naam`);
check('naam van een ander aanpassen kan niet', r2.rows?.length === 0, JSON.stringify(r2));
const r3 = await als(A, `update public.profielen set betrouwbaarheid = 100 where id = '${A}'`);
check('eigen betrouwbaarheid aanpassen kan niet', !!r3.fout, JSON.stringify(r3));
const r4 = await als(A, `update public.profielen set is_beheerder = true where id = '${A}'`);
check('jezelf beheerder maken kan niet', !!r4.fout, JSON.stringify(r4));

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
const r14a = await als(B, `select public.beoordeel(${g1.id}, 'klopt') as s`);
check('melder onder 90%: een bevestiging is niet genoeg', r14a.rows?.[0]?.s === 'wacht', JSON.stringify(r14a));
const r14 = await als(C, `select public.beoordeel(${g1.id}, 'klopt') as s`);
check('bevestigd door twee anderen', r14.rows?.[0]?.s === 'bevestigd', JSON.stringify(r14));
const r15 = await als(D, `select public.beoordeel(${g1.id}, 'klopt')`);
check('afgeronde melding beoordelen kan niet', /al afgerond/.test(r15.fout ?? ''), JSON.stringify(r15));
const k1b = await een(`select huidig_prijs_cent, huidig_merk from public.kroegen where id = ${K1}`);
check('bevestigde prijs staat op de kroeg', k1b.huidig_prijs_cent === 320 && k1b.huidig_merk === 'Heineken', JSON.stringify(k1b));
const pA = await een(`select altijd, betrouwbaarheid::float as b from public.ranglijst where id = '${A}'`);
check('vrijspelen ter plaatse: 50 x 1,5 = 75 punten', pA.altijd === 75, JSON.stringify(pA));
check('bevestigde melding: +10% van wat je mist tot 100 (50 naar 55)', pA.b === 55, JSON.stringify(pA));
const pB = await een(`select altijd, betrouwbaarheid::float as b from public.ranglijst where id = '${B}'`);
check('bevestigen: 5 punten en +3% van wat je mist (50 naar 51,5)', pB.altijd === 5 && pB.b === 51.5, JSON.stringify(pB));

// Prijswijziging met foto in de eigen map
const m2 = await als(B, `select * from public.meld_prijs(${K1}, 'Heineken', 25, 340, null, null, '${A}/lijst.jpg')`);
check('foto in de map van een ander kan niet', /hoort niet bij jou/.test(m2.fout ?? ''), JSON.stringify(m2));
const m3 = await als(B, `select * from public.meld_prijs(${K1}, 'Heineken', 25, 320)`);
check('dezelfde prijs nog eens melden kan niet', /staat er al/.test(m3.fout ?? ''), JSON.stringify(m3));
const m4 = await als(B, `select * from public.meld_prijs(${K1}, 'Heineken', 25, 340, null, null, '${B}/lijst.jpg')`);
const g4 = m4.rows?.[0];
check('prijswijziging melden', g4?.soort === 'wijziging' && g4?.vorige_prijs_cent === 320, JSON.stringify(m4));
await klopt(g4.id, C, A);
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
check('weerlegd: -20 punten en -20% van je score (50 naar 40)', pE.altijd === -20 && pE.b === 40, JSON.stringify(pE));

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
check('melder boven 90% wordt niet meer direct bevestigd', m7.rows?.[0]?.status === 'wacht', JSON.stringify(m7));
check('geen systeem-klopt zonder speler', (await een(`select count(*)::int as n from public.bevestigingen where door_id is null`)).n === 0);
const m7s = await klopt(m7.rows[0].id, E);
check('melder boven 90%: een andere speler bevestigt', m7s === 'bevestigd', m7s);

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
const a4 = await klopt(ga.id, A, B);
check('twee spelers met e-mail bevestigen melding van anonieme speler', a4 === 'bevestigd', JSON.stringify(a4));
const pZ = await een(`select altijd from public.ranglijst where id = '${Z}'`);
check('anonieme speler krijgt punten na bevestiging', pZ.altijd === 30, JSON.stringify(pZ));
const a5 = await als(Z, `select * from public.klopt_nog(${K1})`);
check('anonieme speler kan geen klopt nog doen', /Koppel eerst je e-mailadres/.test(a5.fout ?? ''), JSON.stringify(a5));

// Ook boven 90% betrouwbaarheid wacht een anonieme melder op een andere speler
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
// Extra bier per kroeg (geen punten)
// ---------------------------------------------------------------------------

const K6 = await id('node/6');
const puntenVoor = (await een(`select count(*)::int as n from public.punten`)).n;
const x1 = await als(Y, `select * from public.meld_aanbod(${K6}, 'guinness', null, 50, 650)`);
const ax = x1.rows?.[0];
check('anonieme speler kan Guinness toevoegen', ax?.merk === 'Guinness' && ax?.prijs_cent === 650, JSON.stringify(x1));
const x2 = await als(B, `select * from public.meld_aanbod(${K6}, 'cider')`);
check('onbekende soort kan niet', /soort bier uit de lijst/.test(x2.fout ?? ''), JSON.stringify(x2));
const x3 = await als(B, `select * from public.meld_aanbod(${K6}, 'witbier', 'Wieckse', null, 450)`);
check('prijs zonder glasmaat kan niet', /glasmaat/.test(x3.fout ?? ''), JSON.stringify(x3));
const x4 = await als(B, `select * from public.meld_aanbod(${K6}, 'witbier', 'Wieckse')`);
check('bier zonder prijs toevoegen', !x4.fout && x4.rows?.[0]?.prijs_cent === null, JSON.stringify(x4));
const x5 = await als(C, `select * from public.meld_aanbod(${K6}, 'witbier', 'wieckse')`);
check('hetzelfde bier nog eens zonder prijs kan niet', /staat er al/.test(x5.fout ?? ''), JSON.stringify(x5));
const x6 = await als(null, `select * from public.meld_aanbod(${K6}, 'ipa', 'Lowlander', 33, 550)`);
check('anoniem zonder account kan niets toevoegen', !!x6.fout, JSON.stringify(x6));
const x7 = await als(A, `insert into public.kroeg_aanbod (kroeg_id, soort) values (${K6}, 'ipa')`);
check('direct schrijven in kroeg_aanbod kan niet', /permission denied/.test(x7.fout ?? ''), JSON.stringify(x7));
const puntenNa = (await een(`select count(*)::int as n from public.punten`)).n;
check('extra bier levert geen punten op', puntenNa === puntenVoor, `${puntenVoor} -> ${puntenNa}`);

// Nieuwe prijs vervangt de oude, de oude blijft bewaard
const x8 = await als(C, `select * from public.meld_aanbod(${K6}, 'guinness', null, 50, 690)`);
check('nieuwe prijs voor hetzelfde bier', x8.rows?.[0]?.prijs_cent === 690, JSON.stringify(x8));
const gs = (await db.query(`select status, prijs_cent from public.kroeg_aanbod where kroeg_id = ${K6} and soort = 'guinness' order by id`)).rows;
check('oude prijs blijft bewaard als vervangen', gs.length === 2 && gs[0].status === 'vervangen' && gs[1].status === 'actief', JSON.stringify(gs));
const x9 = await als(null, `select soort_naam, merk, volume_cl, prijs_cent, door from public.aanbod_overzicht where kroeg_id = ${K6} order by volgorde`);
check('overzicht toont alleen wat er nu getapt wordt', x9.rows?.length === 2 && x9.rows[0].prijs_cent === 690 && x9.rows[0].door === 'anna2', JSON.stringify(x9));

// Bevestigen en afkeuren
const G = x8.rows[0].id;
const y1 = await als(Y, `select public.beoordeel_aanbod(${G}, 'klopt')`);
check('anonieme speler kan extra bier niet bevestigen', /Koppel eerst je e-mailadres/.test(y1.fout ?? ''), JSON.stringify(y1));
const y2 = await als(C, `select public.beoordeel_aanbod(${G}, 'klopt')`);
check('eigen extra bier bevestigen kan niet', /eigen melding/.test(y2.fout ?? ''), JSON.stringify(y2));
const y3 = await als(A, `select public.beoordeel_aanbod(${G}, 'klopt') as s`);
const gc = await een(`select gecontroleerd_op from public.kroeg_aanbod where id = ${G}`);
check('klopt zet de datum van controle', y3.rows?.[0]?.s === 'actief' && gc.gecontroleerd_op !== null, JSON.stringify({ y3, gc }));
const y4 = await als(A, `select public.beoordeel_aanbod(${G}, 'klopt_niet') as s`);
check('later toch klopt niet (van de tap): telt als een', y4.rows?.[0]?.s === 'actief', JSON.stringify(y4));
const y5 = await als(B, `select public.beoordeel_aanbod(${G}, 'klopt_niet') as s`);
check('twee keer klopt niet: bier verdwijnt', y5.rows?.[0]?.s === 'weg', JSON.stringify(y5));
const y6 = await als(D, `select public.beoordeel_aanbod(${G}, 'klopt')`);
check('verdwenen bier beoordelen kan niet', /niet meer/.test(y6.fout ?? ''), JSON.stringify(y6));
const W = x4.rows[0].id;
const y7 = await als(B, `select public.beoordeel_aanbod(${W}, 'klopt_niet') as s`);
check('eigen melding intrekken', y7.rows?.[0]?.s === 'weg', JSON.stringify(y7));
const y8 = await als(null, `select count(*)::int as n from public.aanbod_overzicht where kroeg_id = ${K6}`);
check('ingetrokken en afgekeurd bier niet meer in het overzicht', y8.rows?.[0]?.n === 0, JSON.stringify(y8));
const y9 = await als(A, `select public.beoordeel_aanbod(${G}, 'klopt')`);
check('afgekeurd bier opnieuw bevestigen kan niet', /niet meer/.test(y9.fout ?? ''), JSON.stringify(y9));

// ---------------------------------------------------------------------------
// Stamkroeg (kroeg_bijdragers en kroeg_stamgast)
// ---------------------------------------------------------------------------

const KS = (await een(`insert into public.kroegen (osm_id, naam, soort, locatie)
  values ('test/stam', 'Café Stam', 'pub', 'SRID=4326;POINT(5.8800 51.8300)') returning id`)).id;
const stam = async () => (await als(null, `select gebruiker_id, bijdragen from public.kroeg_stamgast where kroeg_id = ${KS}`)).rows?.[0];
const bijdr2 = async (kroeg, wie) => (await als(null, `select bijdragen, plek from public.kroeg_bijdragers where kroeg_id = ${kroeg} and gebruiker_id = '${wie}'`)).rows?.[0];
const bijdr = async (wie) => (await als(null, `select bijdragen, plek from public.kroeg_bijdragers where kroeg_id = ${KS} and gebruiker_id = '${wie}'`)).rows?.[0];

// Anna meldt de eerste prijs. Een melder onder 90% heeft twee anderen nodig; tot die er zijn telt niets.
const s1 = (await als(A, `select * from public.meld_prijs(${KS}, 'Heineken', 25, 300)`)).rows?.[0];
await klopt(s1.id, B);
check('openstaande melding telt niet als bijdrage', (await bijdr(A)) === undefined && (await bijdr(B)) === undefined, JSON.stringify([await bijdr(A), await bijdr(B)]));
await klopt(s1.id, C);
check('bevestigde eigen melding telt', (await bijdr(A))?.bijdragen === 1);
check('"klopt" op een bevestigde melding telt', (await bijdr(B))?.bijdragen === 1 && (await bijdr(C))?.bijdragen === 1);
check('een bijdrage is nog geen stamgast', (await stam()) === undefined, JSON.stringify(await stam()));

// Bram meldt een wijziging, Anna en Carla bevestigen: Bram, Anna en Carla hebben er allemaal twee
const s2 = (await als(B, `select * from public.meld_prijs(${KS}, 'Heineken', 25, 310)`)).rows?.[0];
await klopt(s2.id, C, A);
check('bij gelijkspel wint wie de stand het eerst bereikte', (await stam())?.gebruiker_id === B && (await stam())?.bijdragen === 2, JSON.stringify(await stam()));
check('stamgast heeft plek 1', (await bijdr(B))?.plek === 1);
check('de anderen staan ook op 2 bijdragen', (await bijdr(A))?.bijdragen === 2 && (await bijdr(C))?.bijdragen === 2);

// Eva meldt, Anna en Carla bevestigen: die twee hebben er nu drie, Anna bereikte dat het eerst
const s3 = (await als(E, `select * from public.meld_prijs(${KS}, 'Heineken', 25, 320)`)).rows?.[0];
check('open melding van Eva telt nog niet', (await bijdr(E)) === undefined, JSON.stringify(await bijdr(E)));
await klopt(s3.id, A, C);
check('met een meer neemt Anna het over', (await stam())?.gebruiker_id === A && (await stam())?.bijdragen === 3, JSON.stringify(await stam()));
check('Bram is nu tweede of lager', (await bijdr(B))?.plek > 1);

// Een weerlegde melding en een "klopt niet" tellen niet
const s5 = (await als(E, `select * from public.meld_prijs(${KS}, 'Heineken', 25, 340)`)).rows?.[0];
await als(A, `select public.beoordeel(${s5.id}, 'klopt_niet')`);
await als(B, `select public.beoordeel(${s5.id}, 'klopt_niet')`);
const s5s = await een(`select status from public.gebeurtenissen where id = ${s5.id}`);
check('melding is weerlegd', s5s.status === 'weerlegd', JSON.stringify(s5s));
check('weerlegde melding telt niet voor de melder', (await bijdr(E))?.bijdragen === 1, JSON.stringify(await bijdr(E)));
check('"klopt niet" telt niet als bijdrage', (await bijdr(B))?.bijdragen === 2, JSON.stringify(await bijdr(B)));

// Een melder boven 90% heeft maar een andere speler nodig. Er is nooit een bevestiging zonder speler.
const KT = (await een(`insert into public.kroegen (osm_id, naam, soort, locatie)
  values ('test/stam2', 'Café Vaste Gast', 'pub', 'SRID=4326;POINT(5.8810 51.8310)') returning id`)).id;
const t1 = (await als(D, `select * from public.meld_prijs(${KT}, 'Heineken', 25, 330)`)).rows?.[0];
check('melder boven 90% wacht op een andere speler', t1?.status === 'wacht', JSON.stringify(t1));
check('melder boven 90%: eigen open melding telt nog niet', (await bijdr2(KT, D)) === undefined);
check('melder boven 90%: een andere speler is genoeg', (await klopt(t1.id, E)) === 'bevestigd');
const tb = (await als(null, `select gebruiker_id, bijdragen from public.kroeg_bijdragers where kroeg_id = ${KT} order by gebruiker_id`)).rows;
check('beide spelers hebben een bijdrage', tb?.length === 2 && tb.every((r) => r.bijdragen === 1), JSON.stringify(tb));
check('geen bijdrage zonder speler', !tb?.some((r) => r.gebruiker_id === null), JSON.stringify(tb));
check('geen bevestiging zonder speler in de database', (await een(`select count(*)::int as n from public.bevestigingen where door_id is null`)).n === 0);
const t2 = (await als(D, `select * from public.meld_prijs(${KT}, 'Heineken', 25, 340)`)).rows?.[0];
await klopt(t2.id, E);
const ts = (await als(null, `select gebruiker_id, bijdragen from public.kroeg_stamgast where kroeg_id = ${KT}`)).rows;
check('stamgast door eigen meldingen, maar elke melding is door een ander bevestigd', ts?.length === 1 && ts[0].gebruiker_id === D && ts[0].bijdragen === 2, JSON.stringify(ts));

// ---------------------------------------------------------------------------
// Kaart: een nog niet bevestigde prijs naast de laatst bevestigde
// ---------------------------------------------------------------------------

const KV = (await een(`insert into public.kroegen (osm_id, naam, soort, locatie)
  values ('test/wacht', 'Café Wacht', 'pub', 'SRID=4326;POINT(5.8820 51.8320)') returning id`)).id;
const kaart = async () => (await als(null, `select huidig_prijs_cent, open_melding_id, open_prijs_cent, open_per25_cent, open_merk, open_volume_cl
  from public.kroeg_kaart where id = ${KV}`)).rows?.[0];
const v0 = await kaart();
check('zonder melding geen wachtende prijs op de kaart', v0.open_melding_id === null && v0.open_prijs_cent === null, JSON.stringify(v0));
const v1 = (await als(A, `select * from public.meld_prijs(${KV}, 'Grolsch', 33, 396)`)).rows?.[0];
const k1w = await kaart();
check('onbevestigde eerste prijs staat op de kaart, nog zonder bevestigde prijs', k1w.huidig_prijs_cent === null && k1w.open_prijs_cent === 396 && k1w.open_volume_cl === 33 && k1w.open_merk === 'Grolsch', JSON.stringify(k1w));
check('wachtende prijs is omgerekend naar 25 cl', k1w.open_per25_cent === 300, JSON.stringify(k1w));
// Een speler boven 90% telt dubbel: een oordeel is genoeg voor een melder onder 90%
check('oordeel van een speler boven 90% telt dubbel', (await klopt(v1.id, D)) === 'bevestigd');
const k2w = await kaart();
check('bevestigde prijs staat er, geen wachtende prijs meer', k2w.huidig_prijs_cent === 396 && k2w.open_melding_id === null && k2w.open_prijs_cent === null, JSON.stringify(k2w));
const v2 = (await als(B, `select * from public.meld_prijs(${KV}, 'Grolsch', 33, 450)`)).rows?.[0];
const k3w = await kaart();
check('onbevestigde wijziging staat naast de laatst bevestigde prijs', k3w.huidig_prijs_cent === 396 && k3w.open_prijs_cent === 450, JSON.stringify(k3w));
const spelStat = await een(`select count(*)::int as n from public.kroegen where huidig_prijs_cent = 450`);
check('het spel telt de wachtende prijs niet mee', spelStat.n === 0, JSON.stringify(spelStat));
check('anoniem kan de wachtende prijs lezen', (await als(null, `select open_prijs_cent from public.kroeg_kaart where id = ${KV}`)).rows?.[0]?.open_prijs_cent === 450);
await klopt(v2.id, A, C);
check('na bevestigen is de wijziging de nieuwe prijs', (await kaart()).huidig_prijs_cent === 450);

// Zichtbaarheid en privacy
const sv = await als(null, `select * from public.kroeg_stamgast where kroeg_id = ${KS}`);
check('stamgast is zonder login te lezen', sv.rows?.length === 1, JSON.stringify(sv));
check('overzicht toont geen e-mail of locatie', !Object.keys(sv.rows?.[0] ?? {}).some((k) => /mail|lat|lon|locatie/.test(k)), Object.keys(sv.rows?.[0] ?? {}).join());
const sw = await als(A, `update public.kroeg_bijdragers set bijdragen = 99 where kroeg_id = ${KS}`);
check('bijdragen via het overzicht aanpassen kan niet', !!sw.fout, JSON.stringify(sw));

// ---------------------------------------------------------------------------
// Betrouwbaarheid naar verwachting (voorlopig)
// ---------------------------------------------------------------------------

const BT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${BT}', 'test@example.nl', '{"naam": "Toets"}')`);
const zet = (v) => db.exec(`update public.profielen set betrouwbaarheid = ${v} where id = '${BT}'`);
const na = async (soort, goed) => {
  await db.query(`select private.betrouwbaarheid_na($1, $2, $3)`, [BT, soort, goed]);
  return Number((await een(`select betrouwbaarheid from public.profielen where id = '${BT}'`)).betrouwbaarheid);
};
await zet(95);
check('fout boven 90%: -20% (95 naar 76)', (await na('melding', false)) === 76);
await zet(30);
check('fout van een beginner kost minder (30 naar 24)', (await na('melding', false)) === 24);
await zet(30);
check('goede melding van een beginner levert meer op (30 naar 37)', (await na('melding', true)) === 37);
await zet(50);
check('onjuist oordeel: -6% (50 naar 47)', (await na('oordeel', false)) === 47);
await zet(50);
let stappen = 0;
while ((await na('melding', true)) < 90 && stappen < 100) stappen++;
const top = Number((await een(`select betrouwbaarheid from public.profielen where id = '${BT}'`)).betrouwbaarheid);
check('zonder ervaring blijft de score op 90 staan', top === 90 && (await na('melding', true)) === 90, `${top} na ${stappen + 1} stappen`);
check('van 50 naar 90 kost ongeveer 16 goede meldingen', stappen + 1 >= 14 && stappen + 1 <= 17, String(stappen + 1));
await zet(95);
check('bestaande score boven 90 zakt niet door de drempel', (await na('melding', true)) === 95);
check('niet ervaren: te weinig bevestigde meldingen', (await een(`select private.ervaren_melder('${BT}') as e`)).e === false);
const r90 = await als(BT, `select private.betrouwbaarheid_na('${BT}', 'melding', true)`);
await db.exec(`
  with g as (
    insert into public.gebeurtenissen (kroeg_id, soort, merk, volume_cl, prijs_cent, door_id, status, afgerond_op)
    select ${K2}, 'wijziging', 'Heineken', 25, 300 + n, '${BT}', 'bevestigd', now() from generate_series(1, 20) n
    returning id
  )
  insert into public.bevestigingen (gebeurtenis_id, door_id, oordeel)
  select g.id, u.id, 'klopt' from g cross join (values ('${A}'::uuid), ('${B}'::uuid), ('${C}'::uuid), ('${D}'::uuid), ('${E}'::uuid)) u(id);
`);
check('ervaren: 20 bevestigde meldingen door 5 anderen', (await een(`select private.ervaren_melder('${BT}') as e`)).e === true);
await zet(90);
check('ervaren speler komt wel boven 90 (90 naar 91)', (await na('melding', true)) === 91);
check('speler kan zijn eigen betrouwbaarheid niet ophogen', /permission denied/.test(r90.fout ?? ''), JSON.stringify(r90));

// ---------------------------------------------------------------------------
// Inchecken en Mijn kroegen
// ---------------------------------------------------------------------------

const mijn = async (wie) => (await als(wie, `select kroeg_id, keer from public.mijn_kroegen order by kroeg_id`)).rows ?? [];
check('melding ter plaatse telt als check-in', (await mijn(A)).some((r) => r.kroeg_id === K1), JSON.stringify(await mijn(A)));
const i1 = await als(B, `select * from public.inchecken(${K2}, 51.8451, 5.8651)`);
check('inchecken binnen 75 m', i1.rows?.[0]?.kroeg_id === K2 && i1.rows[0].bron === 'inchecken', JSON.stringify(i1));
const i2 = await als(B, `select * from public.inchecken(${K2}, 51.8451, 5.8651)`);
check('twee keer op een dag inchecken kan niet', /vandaag al ingecheckt/.test(i2.fout ?? ''), JSON.stringify(i2));
const i3 = await als(B, `select * from public.inchecken(${K3}, 51.8475, 5.8640)`);
check('inchecken verder dan 75 m kan niet', /Inchecken kan binnen 75 m/.test(i3.fout ?? ''), JSON.stringify(i3));
const i4 = await als(B, `select * from public.inchecken(${K3}, null, null)`);
check('inchecken zonder locatie kan niet', /locatie/.test(i4.fout ?? ''), JSON.stringify(i4));
const K8 = await id('node/8');
const i5 = await als(B, `select * from public.inchecken(${K8}, 51.8380, 5.8710)`);
check('inchecken in een gesloten kroeg kan niet', !!i5.fout, JSON.stringify(i5));
const i6 = await als(null, `select * from public.inchecken(${K2}, 51.8451, 5.8651)`);
check('zonder login inchecken kan niet', /permission denied/.test(i6.fout ?? ''), JSON.stringify(i6));
const i7 = await als(Z, `select * from public.inchecken(${K2}, 51.8451, 5.8651)`);
check('anonieme speler mag inchecken', i7.rows?.[0]?.kroeg_id === K2, JSON.stringify(i7));
const pB0 = await een(`select altijd from public.ranglijst where id = '${B}'`);
await db.exec(`update public.incheckingen set dag = dag - 1, op = op - interval '1 day' where gebruiker_id = '${B}' and kroeg_id = ${K2}`);
await als(B, `select * from public.inchecken(${K2}, 51.8451, 5.8651)`);
check('een dag later opnieuw inchecken telt als tweede bezoek', (await mijn(B)).find((r) => r.kroeg_id === K2)?.keer === 2, JSON.stringify(await mijn(B)));
check('inchecken levert geen punten op', (await een(`select altijd from public.ranglijst where id = '${B}'`)).altijd === pB0.altijd);
const i8 = await als(A, `select count(*)::int as n from public.incheckingen where gebruiker_id = '${B}'`);
check('check-ins van een ander zijn niet te lezen', i8.rows?.[0]?.n === 0, JSON.stringify(i8));
check('mijn_kroegen toont alleen eigen check-ins', !(await mijn(A)).some((r) => r.kroeg_id === K2), JSON.stringify(await mijn(A)));
check('zonder login geen check-ins te lezen', !!(await als(null, `select * from public.incheckingen`)).fout);
const i9 = await als(A, `insert into public.incheckingen (gebruiker_id, kroeg_id) values ('${A}', ${K3})`);
check('direct een check-in schrijven kan niet', /permission denied/.test(i9.fout ?? ''), JSON.stringify(i9));
await als(A, `delete from public.incheckingen where gebruiker_id = '${B}'`);
check('check-ins van een ander wissen kan niet', (await mijn(B)).length === 1, JSON.stringify(await mijn(B)));
await als(B, `delete from public.incheckingen where gebruiker_id = '${B}'`);
check('eigen check-ins wissen', (await mijn(B)).length === 0, JSON.stringify(await mijn(B)));

// ---------------------------------------------------------------------------
// Kroegen uit Google Maps (tools/google-kroegen)
// ---------------------------------------------------------------------------

const kern = await een(`select private.kroegnaam_kern('Café De Kroeg🍺') a, private.kroegnaam_kern('De Kroeg') b, private.kroegnaam_kern('Eetcafé Daen') c`);
check('naamkern laat café, bar, lidwoorden en emoji weg', kern.a === 'kroeg' && kern.b === 'kroeg' && kern.c === 'daen', JSON.stringify(kern));
const kernPlaats = await een(`select private.kroegnaam_kern('De Bieb Nijmegen', 'Nijmegen') a, private.kroegnaam_kern('Le Café') b`);
check('naamkern laat de plaatsnaam weg', kernPlaats.a === 'bieb', JSON.stringify(kernPlaats));
check('blijft er niets over, dan de hele naam', kernPlaats.b === 'le café', JSON.stringify(kernPlaats));

await db.query(`select private.importeer_kroegen($1, 'Googlestad')`, [JSON.stringify([
  { osm_id: 'node/901', naam: 'De Kroeg', soort: 'pub', lat: 51.84785, lon: 5.86504 },
  { osm_id: 'node/902', naam: 'Samson', soort: 'pub', lat: 51.8467, lon: 5.86216 },
  { osm_id: 'node/903', naam: 'Heel Ander Café', soort: 'pub', lat: 51.84, lon: 5.86 },
  { osm_id: 'node/904', naam: 'Later', soort: 'pub', lat: 51.8477011, lon: 5.8641937 },
  { osm_id: 'node/905', naam: 'Café De Deut', soort: 'pub', lat: 51.8453116, lon: 5.8643378 },
  { osm_id: 'node/906', naam: 'Café De Opera', soort: 'pub', lat: 51.8453603, lon: 5.8644129 },
])]);
const WEEK = (t) => Object.fromEntries(['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'].map((d) => [d, t]));
const gplaats = (id, naam, lat, lon, extra = {}) => ({ place_id: id, naam, soort: 'pub', zekerheid: 'hoog', categorieen: ['Café'], lat, lon, ...extra });
const gimport = async (kroegen, volledig, wie = 'service_role') => {
  await db.exec(`set role ${wie}`);
  try { return (await db.query(`select public.importeer_google_kroegen($1, 'Googlestad', $2) as r`, [JSON.stringify(kroegen), volledig])).rows[0].r; }
  catch (e) { return { fout: e.message }; } finally { await db.exec('reset role'); }
};
const gr1 = await gimport([
  gplaats('gA', 'Café De Kroeg', 51.8478479, 5.8650438, { adres: 'Grotestraat 17', postcode: '6511 VB', beoordeling: 4, telefoon: '+31 24 000 0000', openingstijden: WEEK(['16:00-02:00']) }),
  gplaats('gB', 'Café Samson', 51.8466495, 5.8621528),
  gplaats('gC', 'Nieuwe Bar', 51.8405, 5.8601, { soort: 'bar', zekerheid: 'middel' }),
  gplaats('gX', 'Twijfel', 51.841, 5.861, { zekerheid: 'laag' }),
  // Drukke straat: buurman op 10 m met een andere naam, en twee kroegen op 6 m van elkaar
  gplaats('gG', 'Café Goossens', 51.8477211, 5.8642327),
  gplaats('gD', 'Café de Deut, Speciaalbier Café', 51.8453268, 5.8643242),
  gplaats('gO', 'Café de Opera', 51.845336, 5.86442),
], true);
check('Google-import koppelt aan OSM en voegt nieuwe toe', gr1.gekoppeld_aan_osm === 4 && gr1.nieuw === 2, JSON.stringify(gr1));
const druk = Object.fromEntries((await db.query(`select osm_id, google_place_id from public.kroegen where osm_id in ('node/904', 'node/905', 'node/906')`)).rows.map((r) => [r.osm_id, r.google_place_id]));
check('buurman met een andere naam wordt niet gekoppeld', druk['node/904'] === null, JSON.stringify(druk));
check('twee kroegen naast elkaar krijgen elk hun eigen Google-plaats', druk['node/905'] === 'gD' && druk['node/906'] === 'gO', JSON.stringify(druk));
const gk = Object.fromEntries((await db.query(`select coalesce(osm_id, google_place_id) k, naam, google_place_id, adres, openingstijden, openingstijden_bron, open from public.kroegen where gemeente = 'Googlestad'`)).rows.map((r) => [r.k, r]));
check('OSM-naam blijft leidend, Google vult adres en openingstijden aan', gk['node/901'].naam === 'De Kroeg' && gk['node/901'].google_place_id === 'gA' && gk['node/901'].adres === 'Grotestraat 17, 6511 VB' && gk['node/901'].openingstijden?.vrijdag?.[0] === '16:00-02:00' && gk['node/901'].openingstijden_bron === 'google', JSON.stringify(gk['node/901']));
const kolommen = (await db.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'kroegen'`)).rows.map((r) => r.column_name);
check('geen beoordeling, reviews, telefoon of website opgeslagen', !kolommen.some((c) => /beoordeling|reviews|telefoon|website|google_cid/.test(c)), kolommen.join());
check('kroeg op 57 m met andere naam wordt niet gekoppeld', gk['node/903'].google_place_id === null && gk.gC?.naam === 'Nieuwe Bar', JSON.stringify(gk));
check('zekerheid laag wordt niet geimporteerd', !gk.gX);
const gr2 = await gimport([gplaats('gA', 'Café De Kroeg', 51.8478479, 5.8650438), gplaats('gB', 'Café Samson', 51.8466495, 5.8621528)], true);
check('tweede run werkt bij en telt de gemiste', gr2.bijgewerkt === 2 && gr2.niet_gezien === 4 && gr2.gesloten === 0, JSON.stringify(gr2));
const gr3 = await gimport([gplaats('gA', 'Café De Kroeg', 51.8478479, 5.8650438)], true);
check('alleen-Google-kroegen gaan dicht na 2 gemiste volledige runs', gr3.gesloten === 2, JSON.stringify(gr3));
const gr4 = await gimport([], false);
check('een gedeeltelijke run telt niets als gemist', gr4.niet_gezien === 0, JSON.stringify(gr4));
const gdicht = await een(`select (select open from public.kroegen where google_place_id = 'gC') c, (select open from public.kroegen where osm_id = 'node/902') b`);
check('OSM-kroeg blijft open, daarover beslist de OSM-import', gdicht.c === false && gdicht.b === true, JSON.stringify(gdicht));
check('spelers mogen de Google-import niet aanroepen', !!(await gimport([], false, 'authenticated')).fout);
check('anoniem mag de Google-import niet aanroepen', !!(await gimport([], false, 'anon')).fout);
check('een run zonder openingstijden wist de bekende niet, en ze zijn zonder login te lezen', (await als(null, `select openingstijden from public.kroeg_info where kroeg_id = (select id from public.kroegen where google_place_id = 'gA')`)).rows?.[0]?.openingstijden?.maandag?.[0] === '16:00-02:00');
await gimport([gplaats('gA', 'Café De Kroeg', 51.8478479, 5.8650438, { openingstijden: { maandag: ['16:00–02:00'] } })], false);
check('ongeldige openingstijden van Google worden overgeslagen', (await een(`select openingstijden from public.kroegen where google_place_id = 'gA'`)).openingstijden?.dinsdag?.[0] === '16:00-02:00');

// ---------------------------------------------------------------------------
// Openingstijden en sluitingen gemeld door spelers
// ---------------------------------------------------------------------------

const KM = (await een(`select id from public.kroegen where google_place_id = 'gA'`)).id;
const KM2 = (await een(`select id from public.kroegen where osm_id = 'node/902'`)).id;
const info = async (id) => (await als(null, `select * from public.kroeg_info where kroeg_id = ${id}`)).rows[0];
const nieuweTijden = { ...WEEK(['16:00-01:00']), maandag: [], zaterdag: ['14:00-03:00'] };

const fT1 = await als(A, `select * from public.meld_kroeg(${KM}, 'openingstijden', '{"maandag": ["morgen"]}')`);
check('onzinnige openingstijden worden geweigerd', !!fT1.fout, JSON.stringify(fT1));
const mT = (await als(Y, `select * from public.meld_kroeg(${KM}, 'openingstijden', $1)`, [JSON.stringify(nieuweTijden)])).rows?.[0];
check('ook een anonieme speler kan openingstijden aanpassen', mT?.status === 'wacht', JSON.stringify(mT));
let iT = await info(KM);
check('nieuwe openingstijden gelden meteen, als bron spelers', iT.openingstijden.maandag.length === 0 && iT.openingstijden.zaterdag[0] === '14:00-03:00' && iT.openingstijden_bron === 'spelers', JSON.stringify(iT));
check('de open melding staat in het overzicht met de naam van de melder', iT.open_meldingen?.[0]?.soort === 'openingstijden' && typeof iT.open_meldingen?.[0]?.door === 'string', JSON.stringify(iT.open_meldingen));
check('een tweede melding terwijl er een openstaat kan niet', !!(await als(B, `select * from public.meld_kroeg(${KM}, 'openingstijden', $1)`, [JSON.stringify(WEEK(['12:00-23:00']))])).fout);
check('anoniem mag niet oordelen over openingstijden', !!(await als(Y, `select public.beoordeel_kroegmelding(${mT.id}, 'klopt')`)).fout);
await gimport([gplaats('gA', 'Café De Kroeg', 51.8478479, 5.8650438, { openingstijden: WEEK(['10:00-12:00']) })], false);
check('Google overschrijft openingstijden van spelers niet', (await info(KM)).openingstijden.zaterdag[0] === '14:00-03:00');
check('een keer klopt niet laat de tijden staan', (await als(A, `select public.beoordeel_kroegmelding(${mT.id}, 'klopt_niet') s`)).rows?.[0]?.s === 'wacht');
check('twee keer klopt niet: weerlegd', (await als(B, `select public.beoordeel_kroegmelding(${mT.id}, 'klopt_niet') s`)).rows?.[0]?.s === 'weerlegd');
iT = await info(KM);
check('na weerleggen staan de vorige tijden van Google er weer', iT.openingstijden.zaterdag[0] === '16:00-02:00' && iT.openingstijden_bron === 'google' && iT.open_meldingen === null, JSON.stringify(iT));
const mT2 = (await als(A, `select * from public.meld_kroeg(${KM}, 'openingstijden', $1)`, [JSON.stringify(nieuweTijden)])).rows?.[0];
check('eigen melding bevestigen kan niet', !!(await als(A, `select public.beoordeel_kroegmelding(${mT2.id}, 'klopt')`)).fout);
check('klopt van een ander bevestigt de tijden', (await als(C, `select public.beoordeel_kroegmelding(${mT2.id}, 'klopt') s`)).rows?.[0]?.s === 'bevestigd' && (await info(KM)).openingstijden_bron === 'spelers');

const mG = (await als(Y, `select * from public.meld_kroeg(${KM2}, 'gesloten')`)).rows?.[0];
check('een anonieme speler kan een sluiting melden', mG?.status === 'wacht', JSON.stringify(mG));
check('een gemelde sluiting houdt de kroeg open tot iemand anders het bevestigt', (await een(`select open from public.kroegen where id = ${KM2}`)).open === true);
check('de melder kan een sluiting intrekken', (await als(Y, `select public.beoordeel_kroegmelding(${mG.id}, 'klopt_niet') s`)).rows?.[0]?.s === 'weerlegd');
const mG2 = (await als(A, `select * from public.meld_kroeg(${KM2}, 'gesloten')`)).rows?.[0];
check('klopt van een ander: definitief gesloten', (await als(B, `select public.beoordeel_kroegmelding(${mG2.id}, 'klopt') s`)).rows?.[0]?.s === 'bevestigd');
check('de gesloten kroeg staat niet meer op de kaart', (await een(`select open, gesloten_door_spelers from public.kroegen where id = ${KM2}`)).open === false);
check('een gesloten kroeg nog eens melden kan niet', !!(await als(C, `select * from public.meld_kroeg(${KM2}, 'gesloten')`)).fout);
await db.query(`select private.importeer_kroegen($1, 'Googlestad')`, [JSON.stringify([
  { osm_id: 'node/901', naam: 'De Kroeg', soort: 'pub', lat: 51.84785, lon: 5.86504 },
  { osm_id: 'node/902', naam: 'Samson', soort: 'pub', lat: 51.8467, lon: 5.86216 },
])]);
check('de OSM-import opent een door spelers gesloten kroeg niet opnieuw', (await een(`select open from public.kroegen where id = ${KM2}`)).open === false);
await gimport([gplaats('gB', 'Café Samson', 51.8466495, 5.8621528)], false);
check('de Google-import ook niet', (await een(`select open from public.kroegen where id = ${KM2}`)).open === false);
check('spelers kunnen niet direct in meldingen schrijven', !!(await als(A, `insert into public.kroeg_meldingen (kroeg_id, soort) values (${KM}, 'gesloten')`)).fout);
check('anoniem zonder login kan niets melden', !!(await als(null, `select * from public.meld_kroeg(${KM}, 'gesloten')`)).fout);

// Klopt deze kroeg niet? Verkeerde plek en dubbel
const mP = (await als(Y, `select * from public.meld_kroeg(${KM}, 'verkeerde_plek', null, '  zit aan de overkant  ')`)).rows?.[0];
check('ook een anonieme speler kan een verkeerde plek melden, met toelichting', mP?.status === 'wacht' && mP?.toelichting === 'zit aan de overkant', JSON.stringify(mP));
check('de toelichting staat in het overzicht', (await info(KM)).open_meldingen?.some((m) => m.soort === 'verkeerde_plek' && m.toelichting === 'zit aan de overkant'));
check('bij openingstijden hoort geen toelichting', !!(await als(B, `select * from public.meld_kroeg(${KM}, 'openingstijden', $1, 'hallo')`, [JSON.stringify(WEEK(['11:00-23:00']))])).fout);
check('een toelichting van meer dan 280 tekens kan niet', !!(await als(B, `select * from public.meld_kroeg(${KM}, 'dubbel', null, $1)`, ['x'.repeat(281)])).fout);
check('klopt op een verkeerde plek laat de kroeg op de kaart', (await als(A, `select public.beoordeel_kroegmelding(${mP.id}, 'klopt') s`)).rows?.[0]?.s === 'bevestigd'
  && (await een(`select open from public.kroegen where id = ${KM}`)).open === true);
const mD = (await als(Y, `select * from public.meld_kroeg(${KM}, 'dubbel', null, 'zelfde als Samson')`)).rows?.[0];
check('een dubbele kroeg melden kan, ook zonder e-mailadres', mD?.status === 'wacht', JSON.stringify(mD));
check('een dubbele kroeg blijft staan tot een ander het bevestigt', (await een(`select open from public.kroegen where id = ${KM}`)).open === true);
check('anoniem mag niet oordelen over een dubbele kroeg', !!(await als(Y, `select public.beoordeel_kroegmelding(${mD.id}, 'klopt')`)).fout);
check('klopt van een ander: de dubbele kroeg verdwijnt van de kaart', (await als(B, `select public.beoordeel_kroegmelding(${mD.id}, 'klopt') s`)).rows?.[0]?.s === 'bevestigd'
  && (await een(`select open, gesloten_door_spelers from public.kroegen where id = ${KM}`)).gesloten_door_spelers === true);
check('anoniem zonder login kan geen dubbele kroeg melden', !!(await als(null, `select * from public.meld_kroeg(${KM2}, 'dubbel')`)).fout);

// ---------------------------------------------------------------------------
// Prijzen van menukaarten (eerste stuk geschiedenis, zonder melder)
// ---------------------------------------------------------------------------

await db.query(`select private.importeer_kroegen($1, 'Menustad')`, [JSON.stringify([
  { osm_id: 'node/951', naam: 'Stadscafé Jan', soort: 'pub', lat: 52.1, lon: 5.1 },
  { osm_id: 'node/952', naam: 'Café Twee', soort: 'pub', lat: 52.11, lon: 5.11 },
  { osm_id: 'node/953', naam: 'Café Drie', soort: 'pub', lat: 52.12, lon: 5.12 },
])]);
const MK = Object.fromEntries((await db.query(`select osm_id, id from public.kroegen where gemeente = 'Menustad'`)).rows.map((r) => [r.osm_id, r.id]));
const menuImport = async (rijen, wie = 'service_role') => {
  await db.exec(`set role ${wie}`);
  try { return (await db.query(`select public.importeer_menuprijzen($1) as r`, [JSON.stringify(rijen)])).rows[0].r; }
  catch (e) { return { fout: e.message }; } finally { await db.exec('reset role'); }
};
const mi = await menuImport([
  { kroeg_id: MK['node/951'], merk: 'Hertog Jan', volume_cl: 25, prijs_cent: 390, datum: '2025-12-20', bron_omschrijving: 'foto op Google Maps' },
  { kroeg_id: MK['node/952'], merk: 'Heineken', volume_cl: 25, prijs_cent: 350, datum: '2025-11-01', bron_omschrijving: 'website' },
  { kroeg_id: MK['node/953'], merk: 'Heineken', volume_cl: 25, prijs_cent: 350, datum: '2999-01-01' },
]);
check('menukaartprijzen importeren; een datum in de toekomst wordt overgeslagen', mi.toegevoegd === 2 && mi.overgeslagen === 1, JSON.stringify(mi));
check('spelers mogen geen menukaartprijzen importeren', !!(await menuImport([], 'authenticated')).fout);
check('nog een menukaartprijs terwijl er een openstaat wordt overgeslagen', (await menuImport([{ kroeg_id: MK['node/951'], merk: 'Heineken', volume_cl: 25, prijs_cent: 300, datum: '2025-10-01' }])).overgeslagen === 1);
const mkKaart = (await als(null, `select * from public.kroeg_kaart where id = ${MK['node/951']}`)).rows[0];
check('menukaartprijs staat op de kaart, de kroeg blijft op slot', mkKaart.open_bron === 'menukaart' && mkKaart.open_prijs_cent === 390 && mkKaart.versheid === 'locked' && mkKaart.ontdekker_id === null, JSON.stringify(mkKaart));
const mkTijd = (await als(null, `select * from public.kroeg_tijdlijn where kroeg_id = ${MK['node/951']}`)).rows;
check('menukaartprijs staat in de geschiedenis met de datum van de kaart en zonder melder', mkTijd.length === 1 && mkTijd[0].bron === 'menukaart' && mkTijd[0].door_id === null && new Date(mkTijd[0].op).toISOString().startsWith('2025-12-20'), JSON.stringify(mkTijd));
const mkG = mkTijd[0].id;
check('over een menukaartprijs kun je niet oordelen', !!(await als(B, `select public.beoordeel(${mkG}, 'klopt')`)).fout);
check('dezelfde prijs zonder locatie kan niet', !!(await als(A, `select * from public.meld_prijs(${MK['node/951']}, 'Hertog Jan', 25, 390)`)).fout);
check('dezelfde prijs van ver weg kan niet', !!(await als(A, `select * from public.meld_prijs(${MK['node/951']}, 'Hertog Jan', 25, 390, 52.11, 5.1)`)).fout);
const mkM = (await als(A, `select * from public.meld_prijs(${MK['node/951']}, 'Hertog Jan', 25, 390, 52.1002, 5.1)`)).rows?.[0];
check('ter plaatse bevestigen maakt de speler indiener; daarna wacht het op een ander', mkM?.door_id === A && mkM?.status === 'wacht' && mkM?.soort === 'eerst' && mkM?.ter_plaatse === true, JSON.stringify(mkM));
const mkNa = await een(`select (select status from public.gebeurtenissen where id = ${mkG}) menu, ontdekker_id, huidig_prijs_cent from public.kroegen where id = ${MK['node/951']}`);
check('de menukaartprijs is daarmee afgerond; de speler is ontdekker, nog zonder bevestigde prijs', mkNa.menu === 'bevestigd' && mkNa.ontdekker_id === A && mkNa.huidig_prijs_cent === null, JSON.stringify(mkNa));
check('nog geen punten voor de indiener', (await een(`select count(*)::int n from public.punten where gebeurtenis_id = ${mkM.id}`)).n === 0);
const mkS = await klopt(mkM.id, B, C);
const mkP = await een(`select punten from public.punten where gebeurtenis_id = ${mkM.id} and gebruiker_id = '${A}' and reden = 'vrijgespeeld'`);
check('na bevestiging door anderen: prijs staat erop, indiener krijgt de vrijspeelpunten (ter plaatse)', mkS === 'bevestigd' && mkP?.punten === 75 && (await een(`select huidig_prijs_cent from public.kroegen where id = ${MK['node/951']}`)).huidig_prijs_cent === 390, JSON.stringify({ mkS, mkP }));
const mkAnders = (await als(B, `select * from public.meld_prijs(${MK['node/952']}, 'Heineken', 25, 375)`)).rows?.[0];
check('een andere prijs melden kan van overal', mkAnders?.status === 'wacht' && mkAnders?.door_id === B, JSON.stringify(mkAnders));
check('de menukaartprijs is dan achterhaald', (await een(`select status from public.gebeurtenissen where kroeg_id = ${MK['node/952']} and bron = 'menukaart'`)).status === 'weerlegd');
check('een menukaartprijs heeft nooit een melder', !!(await db.query(`update public.gebeurtenissen set door_id = '${A}' where bron = 'menukaart'`).then(() => null, (e) => e.message)));

// ---------------------------------------------------------------------------
// Teksten van de app, aan te passen door een beheerder
// ---------------------------------------------------------------------------

await db.query(`update public.profielen set is_beheerder = true where id = '${E}'`);
check('een gewone speler kan geen tekst aanpassen', !!(await als(A, `select * from public.zet_tekst('Doe mee', 'Speel mee')`)).fout);
check('zonder login ook niet', !!(await als(null, `select * from public.zet_tekst('Doe mee', 'Speel mee')`)).fout);
const tk1 = (await als(E, `select * from public.zet_tekst('  Doe mee  ', '  Speel mee  ')`)).rows?.[0];
check('een beheerder kan een tekst aanpassen; spaties eromheen vallen weg', tk1?.sleutel === 'Doe mee' && tk1?.tekst === 'Speel mee' && tk1?.door_id === E, JSON.stringify(tk1));
check('iedereen kan de teksten lezen', (await als(null, `select tekst from public.app_teksten where sleutel = 'Doe mee'`)).rows?.[0]?.tekst === 'Speel mee');
check('nog eens aanpassen overschrijft', (await als(E, `select tekst from public.zet_tekst('Doe mee', 'Kom erbij')`)).rows?.[0]?.tekst === 'Kom erbij');
check('een tekst met # voor een getal kan', (await als(E, `select tekst from public.zet_tekst('# kroegen', '# cafés')`)).rows?.[0]?.tekst === '# cafés');
await als(E, `select * from public.zet_tekst('Doe mee', '')`);
check('een lege tekst zet de standaardtekst terug', !(await een(`select 1 as x from public.app_teksten where sleutel = 'Doe mee'`)));
await als(E, `select * from public.zet_tekst('# kroegen', '# kroegen')`);
check('de standaardtekst zelf opslaan haalt de eigen tekst ook weg', !(await een(`select 1 as x from public.app_teksten where sleutel = '# kroegen'`)));
check('spelers kunnen niet direct in de teksten schrijven', !!(await als(A, `insert into public.app_teksten (sleutel, tekst) values ('x', 'y')`)).fout);
check('ook een beheerder niet direct', !!(await als(E, `insert into public.app_teksten (sleutel, tekst) values ('x', 'y')`)).fout);

// ---------------------------------------------------------------------------

console.log(`\n${ok} goed, ${fout} fout`);
process.exit(fout ? 1 : 0);
