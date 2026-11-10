#!/usr/bin/env node
// Meet de menukaartpijplijn op de testset: per stap goed, fout, gemist en twijfel, en de tijd per foto.
// Zie testset/README.md. De foto's staan in testset/fotos/ (niet in Git), op te halen met haal-fotos.mjs.

import { parseArgs } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exifDatum } from "../bron/exif.mjs";
import { kiesDatum, prijsBuitenBereik } from "../bron/controles.mjs";
import { Ocr } from "../bron/ocr.mjs";
import { maakUitsnede } from "../bron/nakijken.mjs";
import { kiesVaasje } from "../bron/vaasje.mjs";
import { LOKAAL, STANDAARD_MODEL, bevestigVaasje, controleerModellen, heeftBierprijzen, herkenLos, leesKaart } from "../bron/menulezer.mjs";
import { STAPPEN, beoordeelDatum, beoordeelJaNee, beoordeelLezen, beoordeelPrijs, telOp } from "./score.mjs";

const MAP = fileURLToPath(new URL(".", import.meta.url));

/** De echte stappen, met een antwoord null als het model niets bruikbaars teruggaf. */
export const STANDAARD_STAPPEN = {
  schift: async (beeld, model) => {
    const a = [];
    const t = await herkenLos([beeld], { model, antwoorden: a });
    return typeof a[0]?.kaart === "boolean" ? t.length > 0 : null;
  },
  controleer: async (beeld, model) => {
    const a = [];
    const ja = await heeftBierprijzen(beeld, { model, antwoorden: a });
    return typeof a[0]?.bierprijzen === "boolean" ? ja : null;
  },
  lees: async (beeld, model) => {
    const a = [];
    const r = await leesKaart(beeld, { model, antwoorden: a });
    // De kop van de kaart reist mee voor de uitsnede (onderdeel nakijken).
    return a[0] == null ? null : Object.assign(r.bieren, { kop: r.kop });
  },
  bevestig: (beeld, vaasje, model) => bevestigVaasje(beeld, vaasje, { model }),
};

/** Leest fotos/<sleutel>/<maat>.jpg; ontbreekt die maat, dan het origineel (s0.jpg). */
export function bestandsLader(fotoMap) {
  return async (sleutel, maat) => {
    for (const naam of [`${maat}.jpg`, "s0.jpg"]) {
      const pad = join(fotoMap, sleutel, naam);
      if (existsSync(pad)) return readFile(pad);
    }
    return null;
  };
}

/** Draait alle stappen op een foto. Elke stap wordt apart beoordeeld; "keten" is wat de echte pijplijn zou opleveren. */
export async function meetFoto(label, { rollen, laad, stappen = STANDAARD_STAPPEN, meta = {}, ocr = null, ocrModus = "volgorde", uitsnedeNaar = null }) {
  const r = { sleutel: label.sleutel, kroeg: label.kroeg, omschrijving: label.omschrijving, uitslag: {}, tijden: {}, fouten: [] };
  if (!(await laad(label.sleutel, "1600"))) return { ...r, ontbreekt: true };
  const begin = performance.now();
  const tijd = async (naam, fn) => {
    const t0 = performance.now();
    try {
      return await fn();
    } catch (e) {
      r.fouten.push(`${naam}: ${e.message}`);
      return null;
    } finally {
      r.tijden[naam] = Math.round(performance.now() - t0);
    }
  };

  // OCR telt als goed als het een bedrag vindt op een foto met bierprijzen, en als gemist als het
  // een echte kaart zou wegfilteren.
  if (ocr) r.bedragen = await tijd("ocr", async () => ocr.bedragen(await laad(label.sleutel, "768")));
  r.uitslag.ocr = ocr ? beoordeelJaNee(r.bedragen == null ? null : r.bedragen.length > 0, label.bierprijzen) : "nvt";
  r.schift = await tijd("schiften", async () => stappen.schift(await laad(label.sleutel, "256"), rollen.schifter));
  r.controle = await tijd("controleren", async () => stappen.controleer(await laad(label.sleutel, "768"), rollen.lezer));
  r.uitslag.schiften = beoordeelJaNee(r.schift, label.kaart);
  r.uitslag.controleren = beoordeelJaNee(r.controle, label.bierprijzen);

  // Lezen en kiezen ook als de controle het mis had, zodat elke stap apart te zien is.
  if (label.bierprijzen || r.controle === true) {
    const groot = await laad(label.sleutel, "1600");
    r.bieren = await tijd("lezen", () => stappen.lees(groot, rollen.lezer));
    const vaasje = kiesVaasje(r.bieren || []);
    // Kan de lezer aanwijzen waar de prijs staat? Dan is een uitsnede voor het nakijken mogelijk.
    r.vak = vaasje ? vaasje.vak ?? null : undefined;
    if (vaasje?.vak && uitsnedeNaar) {
      const knip = maakUitsnede(groot, { vak: vaasje.vak, kop: r.bieren?.kop ?? null });
      if (knip) await uitsnedeNaar(label.sleutel, knip);
    }
    // Geen antwoord bij het lezen is twijfel, niet "geen prijs".
    r.gekozen = { prijs_cent: vaasje?.prijs_cent ?? null, twijfel: r.bieren == null };
    if (vaasje && prijsBuitenBereik(vaasje.prijs_cent)) r.gekozen.twijfel = true;
    else if (vaasje && rollen.kijker) {
      const tweede = await tijd("tweede mening", () => stappen.bevestig(groot, vaasje, rollen.kijker));
      r.tweedeMening = tweede;
      if (!tweede?.klopt) r.gekozen.twijfel = true;
    }
  }
  r.uitslag.lezen = r.bieren === undefined ? "nvt" : beoordeelLezen(r.bieren, label);
  r.uitslag.kiezen = beoordeelPrijs(r.gekozen ?? null, label);
  const weggefilterd = ocr && ocrModus === "filter" && Array.isArray(r.bedragen) && !r.bedragen.length;
  const doorDeKeten = !weggefilterd && r.schift === true && r.controle === true && r.gekozen;
  r.uitslag.keten = beoordeelPrijs(doorDeKeten ? r.gekozen : { prijs_cent: null, twijfel: false }, label);
  // EXIF-datum uit meta.json (haal-fotos.mjs bewaart het origineel niet); anders uit s0.jpg (eigen bestand).
  const opname = "exif" in meta ? meta.exif : exifDatum(await laad(label.sleutel, "s0"));
  r.datum = kiesDatum({ opname, geupload: meta.geupload }).datum;
  r.uitslag.datum = beoordeelDatum(r.datum, label);
  r.ms = Math.round(performance.now() - begin);
  return r;
}

export function rolModel(naam, url) {
  if (!naam || naam === "geen") return null;
  if (naam === "deepseek") return STANDAARD_MODEL;
  return { url, model: naam, sleutel: "lokaal", lokaal: true };
}

function tabel(tel, perFoto) {
  const kol = ["goed", "fout", "gemist", "twijfel", "nvt"];
  const regels = [`${"stap".padEnd(12)}${kol.map((k) => k.padStart(9)).join("")}`];
  for (const s of STAPPEN) regels.push(`${s.padEnd(12)}${kol.map((k) => String(tel[s][k]).padStart(9)).join("")}`);
  const gemeten = perFoto.filter((f) => !f.ontbreekt);
  const gekozen = gemeten.filter((f) => f.vak !== undefined);
  const sec = gemeten.length ? gemeten.reduce((t, f) => t + f.ms, 0) / gemeten.length / 1000 : 0;
  regels.push(`\n${gemeten.length} foto's gemeten, gemiddeld ${sec.toFixed(1)} s per foto`);
  if (gekozen.length) regels.push(`Plek van de prijsregel (vak) gegeven bij ${gekozen.filter((f) => f.vak).length} van ${gekozen.length} gekozen prijzen`);
  regels.push("\nPer foto:");
  for (const f of perFoto) {
    if (f.ontbreekt) {
      regels.push(`  ${f.sleutel.padEnd(22)} foto ontbreekt (haal-fotos.mjs)`);
      continue;
    }
    const prijs = f.gekozen?.prijs_cent != null ? `€${(f.gekozen.prijs_cent / 100).toFixed(2)}${f.gekozen.twijfel ? "?" : ""}` : "-";
    const u = STAPPEN.map((s) => `${s.slice(0, 5)} ${f.uitslag[s]}`).join(", ");
    regels.push(`  ${f.sleutel.padEnd(22)} ${prijs.padEnd(8)} ${(f.ms / 1000).toFixed(1).padStart(6)} s  ${u}${f.fouten.length ? `  (${f.fouten.join("; ")})` : ""}`);
  }
  return regels.join("\n");
}

async function hoofd() {
  const { values: o } = parseArgs({
    options: {
      labels: { type: "string", default: join(MAP, "labels.json") },
      fotos: { type: "string", default: join(MAP, "fotos") },
      uitslagen: { type: "string", default: join(MAP, "uitslagen") },
      url: { type: "string", default: LOKAAL.lezer.url },
      schifter: { type: "string", default: LOKAAL.schifter.model },
      lezer: { type: "string", default: LOKAAL.lezer.model },
      kijker: { type: "string", default: LOKAAL.kijker.model },
      alleen: { type: "string" },
      ocr: { type: "string", default: "volgorde" },
      "zonder-ocr": { type: "boolean", default: false },
      uitsneden: { type: "boolean", default: false },
      naam: { type: "string" },
      hulp: { type: "boolean", short: "h", default: false },
    },
  });
  if (o.hulp) {
    console.log(`Gebruik: node testset/meet.mjs [--lezer model] [--schifter model] [--kijker model|geen] [--url ${LOKAAL.lezer.url}]
  [--alleen sleutel,sleutel] [--naam proef] [--ocr volgorde|filter] [--zonder-ocr] [--uitsneden] [--labels labels.json] [--fotos map] [--uitslagen map]
Model "deepseek" gebruikt DeepSeek (DEEPSEEK_API_KEY) in plaats van een lokaal model.`);
    return;
  }
  const rollen = { schifter: rolModel(o.schifter, o.url), lezer: rolModel(o.lezer, o.url), kijker: rolModel(o.kijker, o.url) };
  try {
    await controleerModellen(Object.values(rollen));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
    return;
  }
  let labels = JSON.parse(await readFile(o.labels, "utf8")).fotos;
  if (o.alleen) {
    const alleen = new Set(o.alleen.split(","));
    labels = labels.filter((l) => alleen.has(l.sleutel));
  }
  const ongecontroleerd = labels.filter((l) => !l.gecontroleerd).length;
  if (ongecontroleerd) console.log(`Let op: ${ongecontroleerd} van ${labels.length} labels zijn nog niet met de hand gecontroleerd.\n`);
  console.log(`Schifter ${rollen.schifter?.model}, lezer ${rollen.lezer?.model}, kijker ${rollen.kijker?.model ?? "geen"}\n`);

  const laad = bestandsLader(o.fotos);
  const ocr = o["zonder-ocr"] ? null : new Ocr({ log: console.log });
  const stempel = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const naam = (o.naam || `${rollen.lezer?.model}-${rollen.kijker?.model ?? "geen"}`).replace(/[^\w.-]+/g, "_");
  // Met --uitsneden: de uitsnede van elke gekozen prijs, om met het oog te controleren of het vak klopt.
  const uitsnedeMap = join(o.uitslagen, `${stempel}-${naam}`);
  const uitsnedeNaar = o.uitsneden ? async (sleutel, jpg) => { await mkdir(uitsnedeMap, { recursive: true }); await writeFile(join(uitsnedeMap, `${sleutel}.jpg`), jpg); } : null;
  const perFoto = [];
  for (const label of labels) {
    const metaPad = join(o.fotos, label.sleutel, "meta.json");
    const meta = existsSync(metaPad) ? JSON.parse(await readFile(metaPad, "utf8")) : {};
    const r = await meetFoto(label, { rollen, laad, meta, ocr, ocrModus: o.ocr, uitsnedeNaar });
    console.log(`${label.sleutel}: ${r.ontbreekt ? "foto ontbreekt" : `${(r.ms / 1000).toFixed(1)} s`}`);
    perFoto.push(r);
  }
  await ocr?.sluit();
  const tel = telOp(perFoto);
  console.log(`\n${tabel(tel, perFoto)}`);

  await mkdir(o.uitslagen, { recursive: true });
  const pad = join(o.uitslagen, `${stempel}-${naam}.json`);
  // Alleen adres en naam van elk model: een sleutel hoort niet in een bestand.
  const rolNamen = Object.fromEntries(Object.entries(rollen).map(([k, m]) => [k, m && { url: m.url, model: m.model }]));
  await writeFile(pad, JSON.stringify({ gemeten: new Date().toISOString(), rollen: rolNamen, per_stap: tel, per_foto: perFoto }, null, 2));
  console.log(`\nUitslag in ${pad}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await hoofd();
