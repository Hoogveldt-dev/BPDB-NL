// Claude kijkt alleen na waar het nodig is.
//
// Na een run schrijven we naar nakijken/<datum>/ (niet in Git):
//   - alle twijfels (modellen oneens, vaste controle afgekeurd);
//   - een willekeurige steekproef van de prijzen waar beide modellen het eens waren, om te meten
//     hoe vaak ze samen fout zitten.
// Per geval een map met uitsnede.jpg (de prijsregel, met marge en de kop van de kaart),
// foto.jpg (de hele foto op 1024 px) en geval.json (gelezen prijs, beide oordelen, reden).
// De subagent menukaart-controleur (.claude/agents/) zet er een oordeel.json naast;
// verwerkOordelen maakt daar de rijen voor importeer_menuprijzen van.

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { leesJpeg, schrijfJpeg } from "./beeld.mjs";
import { leesbaar } from "./fotos.mjs";

/**
 * Een vak [links, boven, rechts, onder] van het model naar pixels. We vragen om fracties (0 tot 1);
 * sommige modellen geven pixels van de afbeelding of promille (0 tot 1000). Geeft null als het niet klopt.
 */
export function naarPixels(vak, breedte, hoogte) {
  if (!Array.isArray(vak) || vak.length !== 4) return null;
  const v = vak.map(Number);
  if (!v.every((x) => Number.isFinite(x) && x >= 0)) return null;
  const max = Math.max(...v);
  let schaal;
  if (max <= 1) schaal = [breedte, hoogte];
  else if (v[0] <= breedte && v[2] <= breedte && v[1] <= hoogte && v[3] <= hoogte) schaal = [1, 1];
  else if (max <= 1000) schaal = [breedte / 1000, hoogte / 1000];
  else return null;
  const [x1, x2] = [v[0] * schaal[0], v[2] * schaal[0]].sort((a, b) => a - b);
  const [y1, y2] = [v[1] * schaal[1], v[3] * schaal[1]].sort((a, b) => a - b);
  const r = { x1: Math.max(0, Math.round(x1)), y1: Math.max(0, Math.round(y1)), x2: Math.min(breedte, Math.round(x2)), y2: Math.min(hoogte, Math.round(y2)) };
  return r.x2 > r.x1 && r.y2 > r.y1 ? r : null;
}

// Een horizontale strook over de hele breedte: de naam van het bier staat vaak ver van de prijs.
function strook(beeld, y1, y2) {
  const boven = Math.max(0, Math.floor(y1));
  const onder = Math.min(beeld.hoogte, Math.ceil(y2));
  const rij = beeld.breedte * 4;
  return { breedte: beeld.breedte, hoogte: onder - boven, data: beeld.data.subarray(boven * rij, onder * rij) };
}

function stapel(stroken) {
  const naad = 6;
  const breedte = stroken[0].breedte;
  const hoogte = stroken.reduce((t, s) => t + s.hoogte, 0) + naad * (stroken.length - 1);
  const data = new Uint8Array(breedte * hoogte * 4).fill(128);
  let y = 0;
  for (const s of stroken) {
    data.set(s.data, y * breedte * 4);
    y += s.hoogte + naad;
  }
  return { breedte, hoogte, data };
}

/** Snijdt de prijsregel uit (met marge), met de kop van de kaart erboven als die er is. JPEG of null. */
export function maakUitsnede(buf, { vak, kop = null } = {}) {
  const beeld = leesJpeg(buf);
  if (!beeld) return null;
  const regel = naarPixels(vak, beeld.breedte, beeld.hoogte);
  if (!regel) return null;
  const marge = Math.max(2 * (regel.y2 - regel.y1), 0.04 * beeld.hoogte);
  const band = [regel.y1 - marge, regel.y2 + marge];
  const k = naarPixels(kop, beeld.breedte, beeld.hoogte);
  const stroken = [];
  if (k && k.y2 < band[0]) stroken.push(strook(beeld, k.y1 - 0.01 * beeld.hoogte, k.y2 + 0.01 * beeld.hoogte));
  else if (k) band[0] = Math.min(band[0], k.y1);
  stroken.push(strook(beeld, band[0], band[1]));
  return schrijfJpeg(stapel(stroken));
}

/** Kiest willekeurig ongeveer fractie van de lijst (minstens 1 als de lijst niet leeg is en fractie > 0). */
export function kiesSteekproef(lijst, fractie, random = Math.random) {
  if (!lijst.length || !(fractie > 0)) return [];
  const gekozen = lijst.filter(() => random() < fractie);
  return gekozen.length ? gekozen : [lijst[Math.floor(random() * lijst.length)]];
}

/** Een vrije map nakijken/<datum>, of nakijken/<datum>-2 als die er al is. */
export function nieuweMap(basis, datum = new Date().toISOString().slice(0, 10)) {
  for (let n = 1; ; n++) {
    const pad = join(basis, n === 1 ? datum : `${datum}-${n}`);
    if (!existsSync(pad)) return pad;
  }
}

const veilig = (s) => String(s).replace(/[^\w-]+/g, "_").slice(0, 40);

/**
 * Schrijft de gevallen weg. Elk geval: { soort: "twijfel"|"steekproef", kroeg, place_id, uitkomst, rij, reden, modellen }.
 * uitkomst is wat zoekMenuprijs teruggaf (met foto, vak, kop, tweede).
 */
export async function schrijfGevallen(map, gevallen, { haalBeeld, rijen = [], log = () => {} }) {
  await mkdir(map, { recursive: true });
  await writeFile(join(map, "rijen.json"), JSON.stringify(rijen, null, 2));
  for (const [i, g] of gevallen.entries()) {
    const u = g.uitkomst;
    const naam = `${String(i + 1).padStart(3, "0")}-${g.soort}-${veilig(g.kroeg)}`;
    const doel = join(map, naam);
    await mkdir(doel, { recursive: true });
    let uitsnede = null;
    try {
      const groot = await haalBeeld(leesbaar(u.foto.url));
      const knip = u.vak ? maakUitsnede(groot, { vak: u.vak, kop: u.kop }) : null;
      if (knip) {
        await writeFile(join(doel, "uitsnede.jpg"), knip);
        uitsnede = "uitsnede.jpg";
      }
      await writeFile(join(doel, "foto.jpg"), await haalBeeld(leesbaar(u.foto.url, 1024)));
    } catch (e) {
      log(`  nakijken ${naam}: ${e.message}`);
    }
    await writeFile(join(doel, "geval.json"), JSON.stringify({
      soort: g.soort,
      kroeg: g.kroeg,
      place_id: g.place_id,
      foto_id: u.foto.id,
      gelezen: { merk: u.merk, volume_cl: u.volume_cl, prijs: u.prijs_cent / 100, datum: u.datum },
      lezer: { model: g.modellen?.lezer ?? null, prijs: u.prijs_cent / 100, zekerheid: u.zekerheid },
      kijker: u.tweede ? { model: g.modellen?.kijker ?? null, klopt: u.tweede.klopt, prijs_op_kaart: u.tweede.prijsOpKaart } : null,
      reden: g.reden ?? null,
      uitsnede,
      foto: "foto.jpg",
      rij: g.rij,
    }, null, 2));
  }
}

/** Leest het oordeel van de controleur; accepteert ook tekst met JSON erin. */
function leesOordeel(tekst) {
  const begin = tekst.indexOf("{");
  const eind = tekst.lastIndexOf("}");
  if (begin < 0 || eind <= begin) return null;
  try {
    const o = JSON.parse(tekst.slice(begin, eind + 1));
    return typeof o.is_menukaart === "boolean" && typeof o.prijs_klopt === "boolean" ? o : null;
  } catch {
    return null;
  }
}

/**
 * Verwerkt de oordelen in een map van nakijken.
 * - twijfel goedgekeurd (is_menukaart en prijs_klopt): naar de rijen; anders niet.
 * - steekproef afgekeurd: uit de rijen; dat telt als "samen fout".
 * - zonder oordeel: twijfels blijven buiten, steekproefrijen blijven staan.
 * Een andere prijs van de controleur (juiste_prijs) importeren we niet: liever geen prijs dan een verkeerde.
 */
export async function verwerkOordelen(map) {
  const rijen = JSON.parse(await readFile(join(map, "rijen.json"), "utf8"));
  const gevallen = [];
  for (const naam of (await readdir(map, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const pad = join(map, naam);
    if (!existsSync(join(pad, "geval.json"))) continue;
    const geval = JSON.parse(await readFile(join(pad, "geval.json"), "utf8"));
    const oordeel = existsSync(join(pad, "oordeel.json")) ? leesOordeel(await readFile(join(pad, "oordeel.json"), "utf8")) : null;
    gevallen.push({ naam, geval, oordeel, goed: oordeel ? oordeel.is_menukaart && oordeel.prijs_klopt : null });
  }
  const zelfde = (a, b) => a.google_place_id === b.google_place_id && a.prijs_cent === b.prijs_cent && a.datum === b.datum;
  let prijzen = [...rijen];
  const rapport = { twijfels: 0, twijfels_goedgekeurd: 0, steekproef: 0, steekproef_afgekeurd: 0, niet_nagekeken: 0, afgekeurd: [] };
  for (const g of gevallen) {
    const { soort, rij } = g.geval;
    rapport[soort === "twijfel" ? "twijfels" : "steekproef"] += 1;
    if (g.oordeel == null) {
      rapport.niet_nagekeken += 1;
      continue;
    }
    if (soort === "twijfel" && g.goed) {
      rapport.twijfels_goedgekeurd += 1;
      if (!prijzen.some((p) => p.google_place_id === rij.google_place_id)) prijzen.push(rij);
    }
    if (soort === "steekproef" && !g.goed) {
      rapport.steekproef_afgekeurd += 1;
      prijzen = prijzen.filter((p) => !zelfde(p, rij));
    }
    if (!g.goed) rapport.afgekeurd.push({ geval: g.naam, kroeg: g.geval.kroeg, gelezen: g.geval.gelezen.prijs, juiste_prijs: g.oordeel.juiste_prijs ?? null, toelichting: g.oordeel.toelichting ?? "" });
  }
  const nagekekenSteekproef = rapport.steekproef - gevallen.filter((g) => g.geval.soort === "steekproef" && !g.oordeel).length;
  rapport.samen_fout = nagekekenSteekproef ? `${rapport.steekproef_afgekeurd} van ${nagekekenSteekproef} (${Math.round((100 * rapport.steekproef_afgekeurd) / nagekekenSteekproef)}%)` : null;
  return { prijzen, rapport };
}
