#!/usr/bin/env node
// Haalt de foto's van de testset op aan de hand van place_id en foto_id uit labels.json.
// De foto's komen in testset/fotos/ en nooit in Git (rechten van de makers, voorwaarden van Google).
//
//   node testset/haal-fotos.mjs                        alle labels met place_id en foto_id
//   node testset/haal-fotos.mjs --kandidaten PLACE_ID  miniaturen en ID's van een kroeg, om labels te kiezen
//
// Spelregels uit docs/menukaartprijzen.md: een kroeg tegelijk, ongeveer 3 seconden tussen verzoeken,
// bij een CAPTCHA meteen stoppen. Draai dit vanaf een thuisverbinding.

import { parseArgs } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FotoBron } from "../bron/fotobron.mjs";
import { Geblokkeerd } from "../bron/transport.mjs";
import { leesbaar, miniatuur, origineel } from "../bron/fotos.mjs";
import { exifDatum } from "../bron/exif.mjs";

const MAP = fileURLToPath(new URL(".", import.meta.url));
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

const { values: o } = parseArgs({
  options: {
    labels: { type: "string", default: join(MAP, "labels.json") },
    fotos: { type: "string", default: join(MAP, "fotos") },
    kandidaten: { type: "string" },
    max: { type: "string", default: "60" },
    "pauze-ms": { type: "string", default: "3000" },
    opnieuw: { type: "boolean", default: false },
    zichtbaar: { type: "boolean", default: false },
  },
});
const pauzeMs = Number(o["pauze-ms"]);

// Dezelfde maten als de pijplijn vraagt, door Google zelf verkleind. Het origineel (vaak meer dan
// 10 MB) is alleen nodig voor de EXIF-datum: die gaat naar meta.json, het bestand bewaren we niet.
const MATEN = { 256: miniatuur, 768: (u) => leesbaar(u, 768), 1600: (u) => leesbaar(u) };

async function haal(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Foto gaf HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const veilig = (id) => String(id).replace(/[^\w-]+/g, "_");

const bron = new FotoBron({ log: console.log, zichtbaar: o.zichtbaar, pauzeMs });
try {
  if (o.kandidaten) {
    // Miniaturen met ID en uploaddatum in een overzicht, zodat Kjell foto's kan kiezen en labelen.
    const dataId = await bron.openPlaats(o.kandidaten);
    const fotos = (await bron.fotolijst(dataId, { maxFotos: Number(o.max) })).filter((f) => f.soort === "foto" && f.url);
    const doel = join(o.fotos, "kandidaten", veilig(o.kandidaten));
    await mkdir(doel, { recursive: true });
    const cellen = [];
    for (const f of fotos) {
      const bestand = `${veilig(f.id)}.jpg`;
      if (!existsSync(join(doel, bestand))) {
        await writeFile(join(doel, bestand), await haal(miniatuur(f.url)));
        await wacht(300);
      }
      const regel = JSON.stringify({ place_id: o.kandidaten, foto_id: f.id });
      cellen.push(`<figure><img src="${bestand}" loading="lazy"><figcaption>${f.geupload || ""}<br><code>${regel.replace(/</g, "&lt;")}</code></figcaption></figure>`);
    }
    await writeFile(join(doel, "overzicht.html"), `<!doctype html><meta charset="utf-8"><title>Kandidaten</title>
<style>body{font:13px system-ui;margin:16px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
img{width:256px;height:256px;object-fit:contain;background:#eee}code{word-break:break-all;font-size:11px}</style>
<p>Kies foto's voor <code>labels.json</code>: neem place_id en foto_id over en vul de rest met de hand in.</p><main>${cellen.join("")}</main>`);
    console.log(`${fotos.length} miniaturen in ${doel}; open overzicht.html`);
  } else {
    const labels = JSON.parse(await readFile(o.labels, "utf8")).fotos.filter((l) => l.bron === "google" && l.place_id && l.foto_id);
    const perKroeg = new Map();
    for (const l of labels) perKroeg.set(l.place_id, [...(perKroeg.get(l.place_id) || []), l]);
    for (const [placeId, groep] of perKroeg) {
      const nodig = groep.filter((l) => o.opnieuw || !existsSync(join(o.fotos, l.sleutel, "1600.jpg")));
      if (!nodig.length) continue;
      console.log(`${groep[0].kroeg} (${placeId}): ${nodig.length} foto's`);
      const ids = new Set(nodig.map((l) => l.foto_id));
      const dataId = await bron.openPlaats(placeId);
      const fotos = await bron.fotolijst(dataId, { maxFotos: 2000, klaar: (alle) => [...ids].every((id) => alle.some((f) => f.id === id)) });
      for (const l of nodig) {
        const f = fotos.find((x) => x.id === l.foto_id);
        if (!f?.url) {
          console.log(`  ${l.sleutel}: foto ${l.foto_id} niet gevonden in de fotolijst`);
          continue;
        }
        const doel = join(o.fotos, l.sleutel);
        await mkdir(doel, { recursive: true });
        for (const [maat, maak] of Object.entries(MATEN)) await writeFile(join(doel, `${maat}.jpg`), await haal(maak(f.url)));
        const exif = exifDatum(await haal(origineel(f.url)));
        await writeFile(join(doel, "meta.json"), JSON.stringify({ foto_id: f.id, geupload: f.geupload, exif, opgehaald: new Date().toISOString().slice(0, 10) }, null, 2));
        console.log(`  ${l.sleutel}: opgehaald`);
        await wacht(1000);
      }
      await wacht(pauzeMs);
    }
    const zelf = JSON.parse(await readFile(o.labels, "utf8")).fotos.filter((l) => l.bron === "bestand" && !existsSync(join(o.fotos, l.sleutel, "s0.jpg")));
    for (const l of zelf) console.log(`${l.sleutel}: zet de afbeelding zelf in ${join(o.fotos, l.sleutel, "s0.jpg")}`);
  }
} catch (e) {
  if (!(e instanceof Geblokkeerd)) throw e;
  console.log(`\n${e.message}. Gestopt; probeer het niet meteen opnieuw.`);
} finally {
  await bron.sluit();
}
