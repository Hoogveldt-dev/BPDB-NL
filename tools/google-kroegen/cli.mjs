#!/usr/bin/env node
// Kroegen en cafés uit Google Maps ophalen voor een gemeente.
// Zie README.md voor uitleg, herkomst van de onderdelen en spelregels.

import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";
import { gemeentegrens } from "./bron/gebied.mjs";
import { bboxVan, maakCellen } from "./bron/raster.mjs";
import { maakTransport } from "./bron/transport.mjs";
import { verzamel, STANDAARD_ZOEKTERMEN } from "./bron/verzamel.mjs";
import { stuurNaarSupabase } from "./bron/supabase.mjs";

const HULP = `Gebruik: node cli.mjs [opties]

Gebied (kies een):
  --gemeentecode GM0268     CBS-code; de gemeentegrens komt van PDOK (standaard GM0268, Nijmegen)
  --bbox minLat,minLon,maxLat,maxLon
  --punt lat,lon            alleen een cel rond dit punt (snelle proef)

Zoeken:
  --zoektermen kroeg,café,bar,pub
  --cel-km 1.5              celgrootte van het raster
  --max-paginas 6           pagina's van 20 per cel en zoekterm
  --pauze-ms 1200           pauze tussen verzoeken (met spreiding)
  --transport auto          auto | http | browser
  --zichtbaar               browser zichtbaar openen (bij --transport browser)
  --clubs                   ook nachtclubs en discotheken
  --alleen-zeker            alleen zaken met een kroegcategorie als hoofdcategorie

Uitvoer:
  --uit bestand.json        standaard google-kroegen-<gemeente>.json
  --naar-supabase           ook importeren (SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY nodig)
  --deels                   geen volledige run: niet-geziene kroegen niet als gemist tellen
  --stil                    minder uitvoer
`;

const { values: o } = parseArgs({
  options: {
    gemeentecode: { type: "string", default: "GM0268" },
    bbox: { type: "string" },
    punt: { type: "string" },
    zoektermen: { type: "string" },
    "cel-km": { type: "string", default: "1.5" },
    "max-paginas": { type: "string", default: "6" },
    "pauze-ms": { type: "string", default: "1200" },
    transport: { type: "string", default: "auto" },
    zichtbaar: { type: "boolean", default: false },
    clubs: { type: "boolean", default: false },
    "alleen-zeker": { type: "boolean", default: false },
    uit: { type: "string" },
    "naar-supabase": { type: "boolean", default: false },
    deels: { type: "boolean", default: false },
    stil: { type: "boolean", default: false },
    hulp: { type: "boolean", short: "h", default: false },
  },
});

if (o.hulp) {
  console.log(HULP);
  process.exit(0);
}

const getallen = (s, n, naam) => {
  const g = s.split(",").map(Number);
  if (g.length !== n || g.some((x) => !Number.isFinite(x))) throw new Error(`Ongeldige ${naam}: ${s}`);
  return g;
};

const log = o.stil ? () => {} : (...a) => console.error(...a);
const celKm = Number(o["cel-km"]);

let gemeente = null;
let geometrie = null;
let cellen;
if (o.punt) {
  const [lat, lon] = getallen(o.punt, 2, "punt");
  cellen = [{ lat, lon }];
} else if (o.bbox) {
  const [minLat, minLon, maxLat, maxLon] = getallen(o.bbox, 4, "bbox");
  cellen = maakCellen({ minLat, minLon, maxLat, maxLon }, celKm);
} else {
  ({ naam: gemeente, geometrie } = await gemeentegrens(o.gemeentecode.toUpperCase()));
  cellen = maakCellen(bboxVan(geometrie), celKm, geometrie);
}

const zoektermen = o.zoektermen ? o.zoektermen.split(",").map((s) => s.trim()).filter(Boolean) : STANDAARD_ZOEKTERMEN;
const volledig = Boolean(gemeente) && !o.deels;
log(`${gemeente ?? "Gebied"}: ${cellen.length} cellen van ${celKm} km, zoektermen ${zoektermen.join(", ")}, transport ${o.transport}`);

const transport = maakTransport(o.transport, { log, zichtbaar: o.zichtbaar });
const begin = Date.now();
let uitkomst;
try {
  uitkomst = await verzamel({
    cellen,
    celKm,
    geometrie,
    zoektermen,
    transport,
    maxPaginas: Number(o["max-paginas"]),
    pauzeMs: Number(o["pauze-ms"]),
    clubs: o.clubs,
    minZekerheid: o["alleen-zeker"] ? "hoog" : "middel",
    log,
  });
} finally {
  await transport.sluit();
}

const { kroegen, genegeerd, verzoeken, gezondheid } = uitkomst;
const rapport = {
  gemeente,
  gemeentecode: gemeente ? o.gemeentecode.toUpperCase() : null,
  opgehaald_op: new Date().toISOString(),
  volledig,
  zoektermen,
  verzoeken,
  duur_s: Math.round((Date.now() - begin) / 1000),
  aantal: kroegen.length,
  genegeerd_geen_kroeg: genegeerd,
  veld_gevuld_pct: gezondheid.percentages(),
  kroegen,
};

const uit = o.uit ?? `google-kroegen-${(gemeente ?? "gebied").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
await writeFile(uit, JSON.stringify(rapport, null, 2));
log(`\n${kroegen.length} kroegen (${genegeerd} andere zaken genegeerd) in ${rapport.duur_s} s, ${verzoeken} verzoeken -> ${uit}`);
log(`Velden gevuld: ${Object.entries(rapport.veld_gevuld_pct).map(([v, p]) => `${v} ${p}%`).join(", ")}`);

if (o["naar-supabase"]) {
  const url = process.env.SUPABASE_URL;
  const sleutel = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !sleutel) throw new Error("Zet SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY om te importeren");
  if (!gemeente) throw new Error("Importeren kan alleen met --gemeentecode (de database koppelt per gemeente)");
  const resultaat = await stuurNaarSupabase({ url, sleutel, gemeente, kroegen, volledig });
  log(`Supabase: ${JSON.stringify(resultaat)}`);
}
