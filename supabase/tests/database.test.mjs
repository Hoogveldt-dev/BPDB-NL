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
// Een willekeurige naam: bijvoeglijk naamwoord, streepje, zelfstandig naamwoord (dorstige-zebra), eventueel met een nummer
const willekeurig = (naam) => /^[a-z]+-[a-z]+[0-9]*$/.test(naam ?? '') && naam.length <= 24;
check('speler zonder gekozen naam krijgt een willekeurige naam en mag nog kiezen', willekeurig(n0?.naam) && n0.naam_vast === false, JSON.stringify(n0));
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
const r12 = await als(B, `select * from public.meld_prijs(${K1}, 'Heineken', 25, 320)`);
check('dezelfde prijs als de open melding is geen nieuwe melding', /staat al open/.test(r12.fout ?? ''), JSON.stringify(r12));
const r13 = await als(A, `select public.beoordeel(${g1.id}, 'klopt')`);
check('eigen melding beoordelen kan niet', /eigen melding/.test(r13.fout ?? ''), JSON.stringify(r13));
check('punten meteen bij melden: 50 x 1,5 = 75, nog voor iemand bevestigt', (await een(`select altijd from public.ranglijst where id = '${A}'`)).altijd === 75);
const r14a = await als(B, `select public.beoordeel(${g1.id}, 'klopt') as s`);
check('melder onder 90%: een bevestiging is niet genoeg', r14a.rows?.[0]?.s === 'wacht', JSON.stringify(r14a));
check('wie "klopt" zegt, krijgt meteen 5 punten', (await een(`select altijd from public.ranglijst where id = '${B}'`)).altijd === 5);
const r14 = await als(C, `select public.beoordeel(${g1.id}, 'klopt') as s`);
check('bevestigd door twee anderen', r14.rows?.[0]?.s === 'bevestigd', JSON.stringify(r14));
const r15 = await als(D, `select public.beoordeel(${g1.id}, 'klopt')`);
check('afgeronde melding beoordelen kan niet', /al afgerond/.test(r15.fout ?? ''), JSON.stringify(r15));
const k1b = await een(`select huidig_prijs_cent, huidig_merk from public.kroegen where id = ${K1}`);
check('bevestigde prijs staat op de kroeg', k1b.huidig_prijs_cent === 320 && k1b.huidig_merk === 'Heineken', JSON.stringify(k1b));
const pA = await een(`select altijd, betrouwbaarheid::float as b from public.ranglijst where id = '${A}'`);
check('na bevestigen blijven het 75 punten, er komen er geen bij', pA.altijd === 75, JSON.stringify(pA));
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
check('de melder heeft de 50 punten al meteen', (await een(`select altijd from public.ranglijst where id = '${E}'`)).altijd === 50);
const pDvoor = (await een(`select altijd from public.ranglijst where id = '${D}'`)).altijd;
await als(D, `select public.beoordeel(${g5.id}, 'klopt')`);
check('D zegt "klopt" en krijgt meteen 5 punten', (await een(`select altijd from public.ranglijst where id = '${D}'`)).altijd === pDvoor + 5);
const r16 = await als(A, `select public.beoordeel(${g5.id}, 'klopt_niet') as s`);
check('een keer "klopt niet" is nog niet genoeg', r16.rows?.[0]?.s === 'wacht', JSON.stringify(r16));
const r17 = await als(A, `select public.beoordeel(${g5.id}, 'klopt_niet')`);
check('twee keer beoordelen door dezelfde speler kan niet', /al beoordeeld/.test(r17.fout ?? ''), JSON.stringify(r17));
const r18 = await als(B, `select public.beoordeel(${g5.id}, 'klopt_niet') as s`);
check('twee keer "klopt niet": weerlegd', r18.rows?.[0]?.s === 'weerlegd', JSON.stringify(r18));
const k2 = await een(`select ontdekker_id from public.kroegen where id = ${K2}`);
check('weerlegde eerste prijs: kroeg weer onder de mist', k2.ontdekker_id === null, JSON.stringify(k2));
const pE = await een(`select altijd, betrouwbaarheid::float as b from public.ranglijst where id = '${E}'`);
check('weerlegd: de 50 punten gaan eraf, plus -20, en -20% van je score (50 naar 40)', pE.altijd === -20 && pE.b === 40, JSON.stringify(pE));
check('wie "klopt" zei bij een weerlegde melding, raakt die 5 punten weer kwijt', (await een(`select altijd from public.ranglijst where id = '${D}'`)).altijd === pDvoor);

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
check('anonieme speler krijgt een willekeurige naam, ook als de app er een meestuurt', willekeurig(nZ?.naam), JSON.stringify(nZ));
const vZ = await een(`select naam_vast from public.profielen where id = '${Z}'`);
check('willekeurige naam staat nog niet vast', vZ?.naam_vast === false, JSON.stringify(vZ));
const nY = await een(`select naam from public.profielen where id = '${Y}'`);
check('anonieme speler zonder naam krijgt een willekeurige naam', willekeurig(nY?.naam) && nY.naam !== nZ.naam, JSON.stringify(nY));
const nF = await een(`select naam from public.profielen where id = '${F}'`);
check('naam is nooit een stuk van het e-mailadres', willekeurig(nF?.naam) && !/frank/i.test(nF.naam), JSON.stringify(nF));
const zelfY = await als(Y, `update public.profielen set naam = 'Yara' where id = '${Y}'`);
check('anonieme speler kan nog geen eigen naam kiezen', /Koppel eerst je e-mailadres/.test(zelfY.fout ?? ''), JSON.stringify(zelfY));
const dubbel = await een(`select count(*)::int as n, count(distinct lower(naam))::int as uniek from public.profielen`);
check('elke naam komt een keer voor', dubbel.n === dubbel.uniek, JSON.stringify(dubbel));

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
check('anonieme speler krijgt punten voor een melding', pZ.altijd === 30, JSON.stringify(pZ));
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
// 30 voor de bevestigde melding en 30 meteen voor de melding die nog wacht (a6)
check('na koppelen blijven naam en punten behouden', pZ2.naam === nZ.naam && pZ2.altijd === 60, JSON.stringify(pZ2));
const zelfZ = await als(Z, `update public.profielen set naam = 'Zoë' where id = '${Z}' returning naam, naam_vast`);
check('na koppelen kiest de speler een eigen naam, die daarna vaststaat', zelfZ.rows?.[0]?.naam === 'Zoë' && zelfZ.rows[0].naam_vast === true, JSON.stringify(zelfZ));
await db.exec(`update public.profielen set naam = 'Yvo' where id = '${Y}'`);
check('beheerder kan de naam van een anonieme speler wijzigen', (await een(`select naam from public.profielen where id = '${Y}'`))?.naam === 'Yvo');
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
check('de indiener krijgt de vrijspeelpunten meteen (ter plaatse 75)', (await een(`select coalesce(sum(punten), 0)::int n from public.punten where gebeurtenis_id = ${mkM.id} and gebruiker_id = '${A}'`)).n === 75);
const mkS = await klopt(mkM.id, B, C);
const mkP = await een(`select punten from public.punten where gebeurtenis_id = ${mkM.id} and gebruiker_id = '${A}' and reden = 'vrijgespeeld'`);
check('na bevestiging door anderen: prijs staat erop, de vrijspeelpunten blijven staan (ter plaatse)', mkS === 'bevestigd' && mkP?.punten === 75 && (await een(`select huidig_prijs_cent from public.kroegen where id = ${MK['node/951']}`)).huidig_prijs_cent === 390, JSON.stringify({ mkS, mkP }));
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
// Samenvoegen: een anonieme speler logt in met een bestaand account
// ---------------------------------------------------------------------------

const alsService = async (q, params) => {
  await db.exec('reset role; set role service_role;');
  try { return { rows: (await db.query(q, params)).rows }; } catch (e) { return { fout: e.message }; } finally { await db.exec('reset role'); }
};
await db.query(`select private.importeer_kroegen($1, 'Samenstad')`, [JSON.stringify([
  { osm_id: 'node/961', naam: 'Samen Een', soort: 'pub', lat: 51.8301, lon: 5.8401 },
  { osm_id: 'node/962', naam: 'Samen Twee', soort: 'pub', lat: 51.8311, lon: 5.8411 },
  { osm_id: 'node/963', naam: 'Samen Drie', soort: 'pub', lat: 51.8321, lon: 5.8421 },
])]);
const SV = Object.fromEntries((await db.query(`select osm_id, id from public.kroegen where gemeente = 'Samenstad'`)).rows.map((r) => [r.osm_id, r.id]));
const S1 = 'a1a1a1a1-0000-0000-0000-000000000001', S2 = 'a2a2a2a2-0000-0000-0000-000000000002', R = 'b1b1b1b1-0000-0000-0000-000000000001';
await db.exec(`insert into auth.users (id, email, raw_user_meta_data, is_anonymous) values
  ('${S1}', null, '{}', true), ('${S2}', null, '{}', true), ('${R}', 'rik@example.nl', '{"naam": "Rik"}', false)`);
const sm1 = (await als(S1, `select * from public.meld_prijs(${SV['node/961']}, 'Heineken', 25, 300, 51.8301, 5.8401)`)).rows?.[0];
await als(S1, `select * from public.inchecken(${SV['node/962']}, 51.8311, 5.8411)`);
await als(R, `select * from public.inchecken(${SV['node/962']}, 51.8311, 5.8411)`);
await db.exec(`insert into public.punten (gebruiker_id, reden, punten) values ('${S1}', 'test', 7)`);
const checkS1 = (await een(`select count(*)::int as n from public.incheckingen where gebruiker_id = '${S1}'`)).n;
check('samenvoegen: de anonieme speler heeft een melding en check-ins', sm1?.door_id === S1 && checkS1 === 2, JSON.stringify({ sm1, checkS1 }));
check('samenvoegen kan een speler niet zelf aanroepen', !!(await als(R, `select public.voeg_samen('${S1}', '${R}')`)).fout);
check('een account met e-mailadres wordt nooit samengevoegd', /anonieme speler/.test((await alsService(`select public.voeg_samen('${A}', '${R}')`)).fout ?? ''));
const sv1 = await alsService(`select public.voeg_samen('${S1}', '${R}') as r`);
check('samenvoegen met de service_role lukt', sv1.rows?.[0]?.r?.meldingen === 1, JSON.stringify(sv1));
const naSV = await een(`select
  (select door_id from public.gebeurtenissen where id = ${sm1.id}) as melder,
  (select ontdekker_id from public.kroegen where id = ${SV['node/961']}) as ontdekker,
  (select count(*)::int from public.punten where gebruiker_id = '${S1}') as punten_oud,
  (select count(*)::int from public.punten where gebruiker_id = '${R}' and reden = 'test') as punten_nieuw,
  (select count(*)::int from public.incheckingen where gebruiker_id = '${S1}') as check_oud,
  (select count(*)::int from public.incheckingen where gebruiker_id = '${R}') as check_nieuw`);
check('melding, ontdekker en punten staan nu onder het account', naSV.melder === R && naSV.ontdekker === R && naSV.punten_oud === 0 && naSV.punten_nieuw === 1, JSON.stringify(naSV));
check('dubbele check-in op dezelfde dag vervalt, de andere gaat mee', naSV.check_oud === 0 && naSV.check_nieuw === 2, JSON.stringify(naSV));
const sm2 = (await als(S2, `select * from public.meld_prijs(${SV['node/963']}, 'Heineken', 25, 320)`)).rows?.[0];
await als(R, `select public.beoordeel(${sm2.id}, 'klopt')`);
const sv2 = await alsService(`select public.voeg_samen('${S2}', '${R}')`);
check('samenvoegen weigert als het account een melding van de anonieme speler beoordeelde', /beoordeeld/.test(sv2.fout ?? ''), JSON.stringify(sv2));
check('na een weigering blijft de anonieme speler zijn melding houden', (await een(`select door_id from public.gebeurtenissen where id = ${sm2.id}`)).door_id === S2);

// ---------------------------------------------------------------------------
// Bugs melden: elke speler via meld_bug, alleen beheerders lezen, hoogstens 10 per dag
// ---------------------------------------------------------------------------

const bug1 = await als(B, `select public.meld_bug('De kaart blijft wit na inchecken', 'kaart, kroeg 3', 'Testbrowser') as id`);
check('een speler meldt een bug', bug1.rows?.[0]?.id > 0, JSON.stringify(bug1));
check('een bug zonder inloggen kan niet', !!(await als(null, `select public.meld_bug('Zonder account melden')`)).fout);
check('een te korte bug wordt geweigerd', /paar woorden/.test((await als(B, `select public.meld_bug('kap')`)).fout ?? ''));
check('direct in bugmeldingen schrijven kan niet', !!(await als(B, `insert into public.bugmeldingen (door_id, tekst) values ('${B}', 'Rechtstreeks erin')`)).fout);
const bugLees = await als(B, `select count(*)::int as n from public.bugmeldingen`);
check('een gewone speler leest geen bugmeldingen, ook niet zijn eigen', bugLees.rows?.[0]?.n === 0, JSON.stringify(bugLees));
await db.exec(`update public.profielen set is_beheerder = true where id = '${E}'`);
const bugBeheer = await als(E, `select tekst, scherm, apparaat, door_id from public.bugmeldingen`);
check('een beheerder leest de bugmeldingen met scherm en browser', bugBeheer.rows?.length === 1 && bugBeheer.rows[0].scherm === 'kaart, kroeg 3' && bugBeheer.rows[0].door_id === B, JSON.stringify(bugBeheer));
await db.exec(`update public.profielen set is_beheerder = false where id = '${E}'`);
for (let i = 0; i < 9; i++) await als(B, `select public.meld_bug('Nog een bug nummer ${i}')`);
check('na 10 bugs op een dag is het genoeg', /al 10 bugs/.test((await als(B, `select public.meld_bug('De elfde bug vandaag')`)).fout ?? ''));

// ---------------------------------------------------------------------------
// Nieuwe stad aanvragen: elke speler via vraag_stad_aan, alleen beheerders lezen en behandelen
// ---------------------------------------------------------------------------

const stad1 = await als(B, `select public.vraag_stad_aan('Arnhem') as id`);
check('een speler vraagt een stad aan', stad1.rows?.[0]?.id > 0, JSON.stringify(stad1));
check('een stad zonder inloggen aanvragen kan niet', !!(await als(null, `select public.vraag_stad_aan('Tiel')`)).fout);
check('dezelfde stad twee keer aanvragen wordt geweigerd', /al aangevraagd/.test((await als(B, `select public.vraag_stad_aan(' arnhem ')`)).fout ?? ''));
check('een stad die al meedoet wordt geweigerd', /doet al mee/.test((await als(B, `select public.vraag_stad_aan('Nijmegen')`)).fout ?? ''));
check('een ongeldige stadsnaam wordt geweigerd', /naam van een stad/.test((await als(B, `select public.vraag_stad_aan('x<script>')`)).fout ?? ''));
check('direct in stadsaanvragen schrijven kan niet', !!(await als(B, `insert into public.stadsaanvragen (door_id, stad) values ('${B}', 'Zwolle')`)).fout);
check('een gewone speler leest geen stadsaanvragen', (await als(B, `select count(*)::int as n from public.stadsaanvragen`)).rows?.[0]?.n === 0);
await als(A, `select public.vraag_stad_aan('Arnhem')`);
check('een gewone speler behandelt geen aanvraag', /beheerders/.test((await als(B, `select public.zet_stadsaanvraag('Arnhem', 'goedgekeurd')`)).fout ?? ''));
await db.exec(`update public.profielen set is_beheerder = true where id = '${E}'`);
const aanv = await als(E, `select count(*)::int as n from public.stadsaanvragen where stad_sleutel = 'arnhem' and status = 'open'`);
check('een beheerder ziet twee open aanvragen voor een stad', aanv.rows?.[0]?.n === 2, JSON.stringify(aanv));
const gezet = await als(E, `select public.zet_stadsaanvraag('Arnhem', 'goedgekeurd') as n`);
check('goedkeuren zet alle aanvragen voor die stad om', gezet.rows?.[0]?.n === 2, JSON.stringify(gezet));
check('een onbekende status wordt geweigerd', /Onbekende status/.test((await als(E, `select public.zet_stadsaanvraag('Arnhem', 'open')`)).fout ?? ''));
await db.exec(`update public.profielen set is_beheerder = false where id = '${E}'`);

// Een nieuwe prijs vervangt een openstaande melding, zonder straf voor de melder
await db.query(`select private.importeer_kroegen($1, 'Vervangstad')`, [JSON.stringify(
  [1, 2, 3, 4, 5, 6, 7].map((n) => ({ osm_id: `node/97${n}`, naam: `Vervang ${n}`, soort: 'pub', lat: 51.8500 + n / 10000, lon: 5.8500 + n / 10000 })))]);
const VK = Object.fromEntries((await db.query(`select osm_id, id from public.kroegen where gemeente = 'Vervangstad'`)).rows.map((r) => [r.osm_id, r.id]));
const X = 'c1c1c1c1-0000-0000-0000-000000000001';
await db.exec(`insert into auth.users (id, email, raw_user_meta_data, is_anonymous) values ('${X}', null, '{}', true)`);
const stand = async (wie) => (await een(`select altijd, betrouwbaarheid::float as b from public.ranglijst where id = '${wie}'`));
const va = (await als(A, `select * from public.meld_prijs(${VK['node/971']}, 'Heineken', 25, 350)`)).rows[0];
await als(B, `select public.beoordeel(${va.id}, 'klopt')`);
const voorA = await stand(A), voorB = await stand(B);
const vx = await als(X, `select * from public.meld_prijs(${VK['node/971']}, 'Heineken', 25, 380)`);
check('een anonieme speler vervangt een melding niet', /e-mailadres/.test(vx.fout ?? ''), JSON.stringify(vx));
check('je eigen melding vervang je niet', /eigen melding/.test((await als(A, `select * from public.meld_prijs(${VK['node/971']}, 'Heineken', 25, 380)`)).fout ?? ''));
check('dezelfde prijs als de open melding vervangt niet', /staat al open/.test((await als(C, `select * from public.meld_prijs(${VK['node/971']}, 'Heineken', 25, 350)`)).fout ?? ''));
check('na die weigeringen wacht de melding nog', (await een(`select status from public.gebeurtenissen where id = ${va.id}`)).status === 'wacht');
const vc = (await als(C, `select * from public.meld_prijs(${VK['node/971']}, 'Heineken', 25, 380)`)).rows?.[0];
check('een andere prijs vervangt de openstaande melding', !!vc && (await een(`select status, vervangen_door from public.gebeurtenissen where id = ${va.id}`)).status === 'vervangen', JSON.stringify(vc));
const vOud = await een(`select vervangen_door, afgerond_op from public.gebeurtenissen where id = ${va.id}`);
check('er staat wie vervangen heeft', vOud.vervangen_door === C && vOud.afgerond_op !== null, JSON.stringify(vOud));
check('de nieuwe melding wacht op bevestiging', vc?.status === 'wacht' && vc?.door_id === C, JSON.stringify(vc));
const naA = await stand(A), naB = await stand(B);
check('de vervangen melder houdt punten en betrouwbaarheid', naA.altijd === voorA.altijd && naA.b === voorA.b, JSON.stringify({ voorA, naA }));
check('wie "klopt" zei bij de oude melding houdt punten en betrouwbaarheid', naB.altijd === voorB.altijd && naB.b === voorB.b, JSON.stringify({ voorB, naB }));
check('een vervangen melding beoordelen kan niet meer', /al afgerond/.test((await als(D, `select public.beoordeel(${va.id}, 'klopt')`)).fout ?? ''));
const vk = await als(null, `select open_prijs_cent, huidig_prijs_cent from public.kroeg_kaart where id = ${VK['node/971']}`);
check('op de kaart staat de nieuwe prijs als wachtend', vk.rows?.[0]?.open_prijs_cent === 380 && vk.rows[0].huidig_prijs_cent === null, JSON.stringify(vk));
const vt = await als(null, `select status from public.kroeg_tijdlijn where id = ${va.id}`);
check('de geschiedenis toont de oude melding als vervangen', vt.rows?.[0]?.status === 'vervangen', JSON.stringify(vt));
await klopt(vc.id, A, D);
check('de nieuwe prijs wordt bevestigd en komt op de kroeg', (await een(`select huidig_prijs_cent from public.kroegen where id = ${VK['node/971']}`)).huidig_prijs_cent === 380);
// Klopt niet werkt nog: twee spelers weerleggen een valse prijs, en de melder verliest punten en betrouwbaarheid
const vb = (await als(B, `select * from public.meld_prijs(${VK['node/972']}, 'Heineken', 25, 99)`)).rows[0];
const voorVB = await stand(B);
await als(A, `select public.beoordeel(${vb.id}, 'klopt_niet')`);
const vWeerlegd = await als(D, `select public.beoordeel(${vb.id}, 'klopt_niet') as s`);
const naVB = await stand(B);
check('klopt niet weerlegt nog steeds een valse prijs, met straf voor de melder', vWeerlegd.rows?.[0]?.s === 'weerlegd' && naVB.altijd < voorVB.altijd && naVB.b < voorVB.b, JSON.stringify({ voorVB, naVB, vWeerlegd }));
// Hoogstens 5 vervangingen per dag
for (let n = 3; n <= 7; n++) {
  await als(A, `select * from public.meld_prijs(${VK[`node/97${n}`]}, 'Heineken', 25, 350)`);
  await als(D, `select * from public.meld_prijs(${VK[`node/97${n}`]}, 'Heineken', 25, 360)`);
}
check('vijf vervangingen op een dag lukken', (await een(`select count(*)::int as n from public.gebeurtenissen where vervangen_door = '${D}'`)).n === 5);
await als(A, `select * from public.meld_prijs(${VK['node/972']}, 'Heineken', 25, 350)`);
const zesde = await als(D, `select * from public.meld_prijs(${VK['node/972']}, 'Heineken', 25, 370)`);
check('de zesde vervanging op een dag wordt geweigerd', /al 5 meldingen/.test(zesde.fout ?? ''), JSON.stringify(zesde));

// Mail naar de beheerder: claim_melding_mail geeft de gegevens voor de mail, hoogstens een keer, alleen aan de melder
const bugId = bug1.rows[0].id;
const stadMail = (await als(B, `select public.vraag_stad_aan('Zwolle') as id`)).rows[0].id;
await als(A, `select public.vraag_stad_aan('Zwolle')`);
check('claim_melding_mail kan een speler niet zelf aanroepen', !!(await als(B, `select public.claim_melding_mail('bug', ${bugId}, '${B}')`)).fout);
check('claim_melding_mail kan anoniem niet worden aangeroepen', !!(await als(null, `select public.claim_melding_mail('bug', ${bugId}, '${B}')`)).fout);
check('claim_melding_mail geeft niets voor een bug van een ander', (await alsService(`select public.claim_melding_mail('bug', ${bugId}, '${A}') as r`)).rows?.[0]?.r === null);
const claimBug = await alsService(`select public.claim_melding_mail('bug', ${bugId}, '${B}') as r`);
check('claim_melding_mail geeft de bug met naam, scherm en browser', claimBug.rows?.[0]?.r?.tekst === 'De kaart blijft wit na inchecken' && claimBug.rows[0].r.scherm === 'kaart, kroeg 3' && claimBug.rows[0].r.apparaat === 'Testbrowser' && !!claimBug.rows[0].r.naam, JSON.stringify(claimBug));
check('een bug wordt maar een keer gemaild', (await alsService(`select public.claim_melding_mail('bug', ${bugId}, '${B}') as r`)).rows?.[0]?.r === null);
await db.exec(`update public.bugmeldingen set gemaild_op = null where id = ${bugId}`);
check('na vrijgeven kan de mail opnieuw', (await alsService(`select public.claim_melding_mail('bug', ${bugId}, '${B}') as r`)).rows?.[0]?.r?.soort === 'bug');
const claimStad = await alsService(`select public.claim_melding_mail('stad', ${stadMail}, '${B}') as r`);
check('claim_melding_mail geeft de stad met het aantal spelers', claimStad.rows?.[0]?.r?.stad === 'Zwolle' && claimStad.rows[0].r.spelers === 2, JSON.stringify(claimStad));
check('een stadsaanvraag wordt maar een keer gemaild', (await alsService(`select public.claim_melding_mail('stad', ${stadMail}, '${B}') as r`)).rows?.[0]?.r === null);
await db.exec(`update public.bugmeldingen set op = now() - interval '1 hour', gemaild_op = null where id = ${bugId}`);
check('een oude melding wordt niet meer gemaild', (await alsService(`select public.claim_melding_mail('bug', ${bugId}, '${B}') as r`)).rows?.[0]?.r === null);
check('een onbekende soort wordt geweigerd', /Onbekende soort/.test((await alsService(`select public.claim_melding_mail('iets', 1, '${B}')`)).fout ?? ''));

// Een foto van de kaart, los van een prijsmelding: meld_foto, +5 voor de eerste foto per kroeg, eigen foto verwijderen
const fotoPad = (wie, n, kroeg = K1) => `${wie}/${kroeg}-17000000000${String(n).padStart(2, '0')}.jpg`;
const uploadFoto = (wie, n, kroeg = K1) => als(wie, `insert into storage.objects (bucket_id, name) values ('prijslijsten', '${fotoPad(wie, n, kroeg)}')`);
await uploadFoto(A, 1);
const punten0 = await stand(A);
const f1 = await als(A, `select * from public.meld_foto(${K1}, '${fotoPad(A, 1)}')`);
check('een speler zet een foto van de kaart bij een kroeg', f1.rows?.[0]?.kroeg_id === K1 && f1.rows[0].door_id === A, JSON.stringify(f1));
check('de eerste foto bij een kroeg levert 5 punten', f1.rows?.[0]?.punten === 5 && (await stand(A)).altijd === punten0.altijd + 5, JSON.stringify({ f1: f1.rows?.[0], punten0, nu: await stand(A) }));
check('een foto zonder inloggen kan niet', !!(await als(null, `select * from public.meld_foto(${K1}, '${fotoPad(A, 1)}')`)).fout);
check('een foto in de map van een ander kan niet', /hoort niet bij jou/.test((await als(B, `select * from public.meld_foto(${K1}, '${fotoPad(A, 1)}')`)).fout ?? ''));
check('een foto die niet is geüpload kan niet', /niet aangekomen/.test((await als(A, `select * from public.meld_foto(${K1}, '${fotoPad(A, 2)}')`)).fout ?? ''));
check('een ongeldig pad wordt geweigerd', /geen geldige foto/.test((await als(A, `select * from public.meld_foto(${K1}, 'foto.jpg')`)).fout ?? ''));
check('dezelfde foto twee keer kan niet', /al toegevoegd/.test((await als(A, `select * from public.meld_foto(${K1}, '${fotoPad(A, 1)}')`)).fout ?? ''));
check('een foto bij een onbekende kroeg kan niet', /Kroeg bestaat niet/.test((await als(A, `select * from public.meld_foto(999999, '${fotoPad(A, 1)}')`)).fout ?? ''));
check('direct in kroeg_fotos schrijven kan niet', !!(await als(A, `insert into public.kroeg_fotos (kroeg_id, door_id, pad) values (${K1}, '${A}', '${fotoPad(A, 3)}')`)).fout);
check('een foto wijzigen of wissen kan niet', !!(await als(A, `update public.kroeg_fotos set kroeg_id = ${K2}`)).fout && !!(await als(A, `delete from public.kroeg_fotos`)).fout);
const fo = await als(null, `select door, pad from public.kroeg_foto_overzicht where kroeg_id = ${K1}`);
check('iedereen ziet de foto met alleen de spelersnaam', fo.rows?.length === 1 && fo.rows[0].door === 'Anna' && fo.rows[0].pad === fotoPad(A, 1), JSON.stringify(fo));
// Een tweede foto bij dezelfde kroeg levert niets op, een eerste foto bij een andere kroeg weer 5
await uploadFoto(A, 2);
const f2 = await als(A, `select * from public.meld_foto(${K1}, '${fotoPad(A, 2)}')`);
check('een tweede foto bij dezelfde kroeg levert geen punten op', f2.rows?.[0]?.punten === 0 && (await stand(A)).altijd === punten0.altijd + 5, JSON.stringify(f2));
await uploadFoto(A, 3, K2);
const f3 = await als(A, `select * from public.meld_foto(${K2}, '${fotoPad(A, 3, K2)}')`);
check('de eerste foto bij een andere kroeg levert weer 5 punten op', f3.rows?.[0]?.punten === 5 && (await stand(A)).altijd === punten0.altijd + 10, JSON.stringify(f3));
// Verwijderen: alleen je eigen foto, de punten gaan eraf, hij verdwijnt voor iedereen
check('een ander verwijdert jouw foto niet', /eigen foto/.test((await als(B, `select public.verwijder_foto(${f1.rows[0].id})`)).fout ?? ''));
check('een foto verwijderen zonder inloggen kan niet', !!(await als(null, `select public.verwijder_foto(${f1.rows[0].id})`)).fout);
const weg = await als(A, `select public.verwijder_foto(${f1.rows[0].id}) as pad`);
check('je verwijdert je eigen foto en krijgt het pad terug', weg.rows?.[0]?.pad === fotoPad(A, 1), JSON.stringify(weg));
check('de punten van de verwijderde foto gaan eraf', (await stand(A)).altijd === punten0.altijd + 5, JSON.stringify(await stand(A)));
check('een verwijderde foto is voor niemand meer te zien', (await als(null, `select count(*)::int as n from public.kroeg_foto_overzicht where id = ${f1.rows[0].id}`)).rows?.[0]?.n === 0 && (await als(null, `select count(*)::int as n from public.kroeg_fotos where id = ${f1.rows[0].id}`)).rows?.[0]?.n === 0);
check('een verwijderde foto nog eens verwijderen kan niet', /bestaat niet/.test((await als(A, `select public.verwijder_foto(${f1.rows[0].id})`)).fout ?? ''));
// Verwijderen en opnieuw uploaden bij dezelfde kroeg levert niets op: de eerdere foto telt mee
await uploadFoto(A, 4);
const f4 = await als(A, `select * from public.meld_foto(${K1}, '${fotoPad(A, 4)}')`);
check('opnieuw uploaden na verwijderen levert geen punten op', f4.rows?.[0]?.punten === 0 && (await stand(A)).altijd === punten0.altijd + 5, JSON.stringify(f4));
// De daglimiet telt verwijderde foto's mee: tot nu toe 4 foto's (een verwijderd), nog 6 erbij
for (let n = 5; n <= 10; n++) { await uploadFoto(A, n); await als(A, `select * from public.meld_foto(${K1}, '${fotoPad(A, n)}')`); }
await uploadFoto(A, 11);
check('na 10 foto\'s op een dag is het genoeg, een verwijderde telt mee', /al 10 foto/.test((await als(A, `select * from public.meld_foto(${K1}, '${fotoPad(A, 11)}')`)).fout ?? ''));

// Samenvoegen neemt ook foto's van de kaart, bugmeldingen en stadsaanvragen mee (20261121220000_samenvoegen_fotos)
const S3 = 'a3a3a3a3-0000-0000-0000-000000000003';
await db.exec(`insert into auth.users (id, email, raw_user_meta_data, is_anonymous) values ('${S3}', null, '{}', true)`);
const KS1 = SV['node/961'], KS2 = SV['node/962'];
await uploadFoto(R, 1, KS1);
await als(R, `select * from public.meld_foto(${KS1}, '${fotoPad(R, 1, KS1)}')`);
await uploadFoto(S3, 1, KS1); await uploadFoto(S3, 2, KS2);
const fs1 = (await als(S3, `select * from public.meld_foto(${KS1}, '${fotoPad(S3, 1, KS1)}')`)).rows?.[0];
const fs2 = (await als(S3, `select * from public.meld_foto(${KS2}, '${fotoPad(S3, 2, KS2)}')`)).rows?.[0];
const bugS3 = (await als(S3, `select public.meld_bug('Bug van een anonieme speler') as id`)).rows?.[0]?.id;
await als(R, `select public.vraag_stad_aan('Deventer')`);
await als(S3, `select public.vraag_stad_aan('Deventer')`);
const stadS3 = (await als(S3, `select public.vraag_stad_aan('Zutphen') as id`)).rows?.[0]?.id;
check('samenvoegen: de anonieme speler heeft twee foto\'s met punten, een bug en twee stadsaanvragen',
  fs1?.punten === 5 && fs2?.punten === 5 && bugS3 > 0 && stadS3 > 0, JSON.stringify({ fs1, fs2, bugS3, stadS3 }));
const voorS3 = (await een(`select coalesce(sum(punten), 0)::int as n from public.punten where gebruiker_id = '${R}'`)).n;
const sv3 = await alsService(`select public.voeg_samen('${S3}', '${R}') as r`);
check('samenvoegen meldt hoeveel foto\'s meegaan', sv3.rows?.[0]?.r?.fotos === 2, JSON.stringify(sv3));
const naS3 = await een(`select
  (select count(*)::int from public.kroeg_fotos where door_id = '${R}') as fotos,
  (select count(*)::int from public.kroeg_fotos where door_id = '${S3}') as fotos_oud,
  (select punten from public.kroeg_fotos where id = ${fs1.id}) as punten_dubbel,
  (select punten from public.kroeg_fotos where id = ${fs2.id}) as punten_nieuw,
  (select coalesce(sum(punten), 0)::int from public.punten where gebruiker_id = '${R}') as punten,
  (select door_id from public.bugmeldingen where id = ${bugS3}) as bug,
  (select count(*)::int from public.stadsaanvragen where door_id = '${R}' and stad_sleutel = 'deventer') as deventer,
  (select door_id from public.stadsaanvragen where id = ${stadS3}) as zutphen,
  (select count(*)::int from public.stadsaanvragen where door_id = '${S3}') as steden_oud`);
check('de foto\'s staan nu onder het account', naS3.fotos === 3 && naS3.fotos_oud === 0, JSON.stringify(naS3));
check('een foto bij een kroeg waar het account al een foto had, levert geen punten meer op; de andere wel',
  naS3.punten_dubbel === 0 && naS3.punten_nieuw === 5 && naS3.punten === voorS3 + 5, JSON.stringify({ voorS3, naS3 }));
check('bugmelding en stadsaanvraag staan onder het account, een dubbele aanvraag vervalt',
  naS3.bug === R && naS3.deventer === 1 && naS3.zutphen === R && naS3.steden_oud === 0, JSON.stringify(naS3));
const wegS3 = await als(R, `select public.verwijder_foto(${fs2.id}) as pad`);
check('na samenvoegen verwijdert het account de foto van zijn anonieme speler, en de punten gaan eraf',
  wegS3.rows?.[0]?.pad === fotoPad(S3, 2, KS2) && (await een(`select coalesce(sum(punten), 0)::int as n from public.punten where gebruiker_id = '${R}'`)).n === voorS3,
  JSON.stringify(wegS3));

// Stadskeuze: de tijdlijn kent de gemeente van de kroeg, zodat de app de koers per stad laadt
const tlStad = await een(`select count(*)::int as n, bool_and(t.gemeente = k.gemeente) as goed
  from public.kroeg_tijdlijn t join public.kroegen k on k.id = t.kroeg_id`);
check('kroeg_tijdlijn heeft de gemeente van de kroeg', tlStad.n > 0 && tlStad.goed === true, JSON.stringify(tlStad));

// ---------------------------------------------------------------------------
// Kaartscans: iedereen voegt een scan toe, niemand leest, wijzigt of wist via de API
// ---------------------------------------------------------------------------

check('anoniem een kaartscan toevoegen', !(await als(null, `insert into public.kaartscans (bron) values ('kaartje')`)).fout);
check('ingelogd een kaartscan toevoegen', !(await als(A, `insert into public.kaartscans (bron) values ('kaartje')`)).fout);
check('een ongeldige bron wordt geweigerd', /kaartscans_bron_check/.test((await als(null, `insert into public.kaartscans (bron) values ('Kaartje!')`)).fout ?? ''));
check('zelf een tijdstip invullen kan niet', !!(await als(null, `insert into public.kaartscans (bron, op) values ('kaartje', now() - interval '1 year')`)).fout);
check('anoniem kaartscans lezen kan niet', !!(await als(null, `select count(*) from public.kaartscans`)).fout);
check('ingelogd kaartscans lezen kan niet', !!(await als(A, `select count(*) from public.kaartscans`)).fout);
check('kaartscans wijzigen kan niet', !!(await als(null, `update public.kaartscans set bron = 'anders'`)).fout);
check('kaartscans wissen kan niet', !!(await als(A, `delete from public.kaartscans`)).fout);
const scans = await een(`select count(*)::int as n, bool_and(bron = 'kaartje') as goed from public.kaartscans`);
check('de beheerder telt twee scans in de SQL Editor', scans.n === 2 && scans.goed === true, JSON.stringify(scans));

console.log(`\n${ok} goed, ${fout} fout`);
process.exit(fout ? 1 : 0);
