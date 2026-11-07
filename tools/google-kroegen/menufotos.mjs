#!/usr/bin/env node
// JAN-methode: vaasjesprijzen van menukaartfoto's in Google Maps.
// Zie docs/menukaartprijzen.md voor de werkwijze en de spelregels.

import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { FotoBron } from "./bron/fotobron.mjs";
import { Geblokkeerd } from "./bron/transport.mjs";
import { naarMenuImport, zoekMenuprijs } from "./bron/menuprijs.mjs";
import { maakBlad } from "./bron/contactblad.mjs";
import { LOKAAL, bevestigVaasje, heeftBierprijzen, herkenLos, herkenOpBlad, leesKaart, verbruik } from "./bron/menulezer.mjs";

const HULP = `Gebruik: node menufotos.mjs [opties]

Welke kroegen (kies een):
  --place-id ID[,ID...]     Google Place ID's
  --kroegen bestand.json    uitvoer van cli.mjs (google-kroegen-<gemeente>.json)

Opties:
  --sinds 2024-01-01        alleen foto's die sindsdien zijn geupload
  --max-fotos 400           foto's per kroeg
  --max-kroegen 20          stop na zoveel kroegen
  --pauze-ms 3000           pauze tussen verzoeken aan Google (met spreiding)
  --volledig                alle foto's bekijken, niet stoppen bij de eerste prijs
  --zichtbaar               browser zichtbaar openen
  --uit menuprijzen.json    standaard menuprijzen.json
  --naar-supabase           ook importeren (SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY nodig)
  --lokaal                  lokale modellen via Ollama of LM Studio, zonder limiet:
                            Llama 3.2 Vision schift per foto en geeft een tweede mening,
                            Qwen2.5-VL controleert en leest. Zie docs/lokale-vision.md.

Model: DeepSeek (deepseek-flash) via DEEPSEEK_API_KEY. Ander model in het
OpenAI-formaat: MENU_MODEL_URL en MENU_MODEL. Met --lokaal: LOKAAL_URL
(standaard http://localhost:11434/v1), LOKAAL_LEZER en LOKAAL_KIJKER.

Google blokkeert snel vanaf datacenters: draai dit vanaf een thuisverbinding.
Bij een CAPTCHA stopt de run; wat al gevonden is, wordt bewaard.
`;

const { values: o } = parseArgs({
  options: {
    "place-id": { type: "string" },
    kroegen: { type: "string" },
    sinds: { type: "string" },
    "max-fotos": { type: "string", default: "400" },
    "max-kroegen": { type: "string" },
    "pauze-ms": { type: "string", default: "3000" },
    zichtbaar: { type: "boolean", default: false },
    volledig: { type: "boolean", default: false },
    uit: { type: "string", default: "menuprijzen.json" },
    "naar-supabase": { type: "boolean", default: false },
    lokaal: { type: "boolean", default: false },
    hulp: { type: "boolean", short: "h", default: false },
  },
});

if (o.hulp || (!o["place-id"] && !o.kroegen)) {
  console.log(HULP);
  process.exit(o.hulp ? 0 : 1);
}

let kroegen = [];
if (o["place-id"]) kroegen = o["place-id"].split(",").map((id) => ({ place_id: id.trim(), naam: id.trim() }));
else kroegen = JSON.parse(await readFile(o.kroegen, "utf8")).filter((k) => k.place_id);
if (o["max-kroegen"]) kroegen = kroegen.slice(0, Number(o["max-kroegen"]));

async function haalBeeld(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Foto gaf HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const bron = new FotoBron({ log: console.log, zichtbaar: o.zichtbaar, pauzeMs: Number(o["pauze-ms"]) });
let bladPagina = null;
const rijen = [];
const verslag = [];
try {
  for (const k of kroegen) {
    console.log(`${k.naam} (${k.place_id})`);
    try {
      const dataId = await bron.openPlaats(k.place_id);
      const fotos = await bron.fotolijst(dataId, { maxFotos: Number(o["max-fotos"]) });
      bladPagina ??= await bron.browser.newPage();
      // Lokaal: elke foto apart schiften (kost niets) en een tweede mening van het andere model.
      // Anders: een contactblad per 20 foto's, zuinig met tokens.
      const stappen = o.lokaal
        ? {
          herken: (miniaturen, opties) => herkenLos(miniaturen, { ...opties, model: LOKAAL.kijker }),
          controleer: (foto, opties) => heeftBierprijzen(foto, { ...opties, model: LOKAAL.lezer }),
          lees: (foto, opties) => leesKaart(foto, { ...opties, model: LOKAAL.lezer, maxTokens: 2000 }),
          bevestig: (foto, vaasje, opties) => bevestigVaasje(foto, vaasje, { ...opties, model: LOKAAL.kijker }),
          maxKandidaten: 12,
        }
        : { herken: async (miniaturen, opties) => herkenOpBlad(await maakBlad(bladPagina, miniaturen, { px: 240, kolommen: 5 }), miniaturen.length, opties) };
      const r = await zoekMenuprijs(fotos, { haalBeeld, ...stappen, sinds: o.sinds, volledig: o.volledig, log: console.log });
      verslag.push({
        place_id: k.place_id, naam: k.naam, bekeken: r.bekeken, kaarten: r.kaarten, prijs: r.prijs && naarMenuImport(k.place_id, r.prijs),
        // Prijzen waar de modellen het niet over eens waren: nakijken, niet importeren
        twijfels: r.twijfels.map((t) => ({ ...naarMenuImport(k.place_id, t), foto: t.foto.url, tweede_mening: t.tweedePrijs })),
      });
      if (r.prijs) {
        rijen.push(naarMenuImport(k.place_id, r.prijs));
        console.log(`  => ${r.prijs.merk} 25 cl EUR ${(r.prijs.prijs_cent / 100).toFixed(2)} (${r.prijs.datum})`);
      } else {
        console.log("  => geen vaasjesprijs gevonden");
      }
    } catch (e) {
      if (e instanceof Geblokkeerd) throw e;
      console.log(`  fout: ${e.message}`);
      verslag.push({ place_id: k.place_id, naam: k.naam, fout: e.message });
    }
  }
} catch (e) {
  if (!(e instanceof Geblokkeerd)) throw e;
  console.log(`\n${e.message}. Gestopt; ${rijen.length} prijzen bewaard.`);
} finally {
  await bron.sluit();
  await writeFile(o.uit, JSON.stringify({ prijzen: rijen, verslag }, null, 2));
  console.log(`\n${rijen.length} prijzen in ${o.uit}`);
  console.log(`Model: ${verbruik.verzoeken} verzoeken, ${verbruik.in} tokens in, ${verbruik.uit} tokens uit`);
}

if (o["naar-supabase"] && rijen.length) {
  const url = process.env.SUPABASE_URL;
  const sleutel = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !sleutel) throw new Error("Zet SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/importeer_menuprijzen`, {
    method: "POST",
    headers: { apikey: sleutel, Authorization: `Bearer ${sleutel}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_prijzen: rijen }),
  });
  const tekst = await res.text();
  if (!res.ok) throw new Error(`Supabase gaf ${res.status}: ${tekst}`);
  console.log(`Geimporteerd: ${tekst}`);
}
