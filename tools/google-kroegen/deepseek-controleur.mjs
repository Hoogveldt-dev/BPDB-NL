#!/usr/bin/env node
// Nakijken met DeepSeek in plaats van de Haiku-subagent: per geval in nakijken/<datum>/ een oordeel.json.
// De opdracht is dezelfde als die van de menukaart-controleur (.claude/agents/menukaart-controleur.md), zodat
// de regels op een plek staan. Het model krijgt geval.json, uitsnede.jpg en foto.jpg in een keer.
//
// Gebruik: node deepseek-controleur.mjs nakijken/<datum> [--opnieuw] [--uit oordeel.json]
// Vanuit een cloudsessie met NODE_USE_ENV_PROXY=1, zodat de proxy de DeepSeek-sleutel toevoegt.

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const MODEL = { url: process.env.MENU_MODEL_URL || "https://api.deepseek.com", model: process.env.MENU_MODEL || "deepseek-flash" };
const AGENT = join(dirname(fileURLToPath(import.meta.url)), "../../.claude/agents/menukaart-controleur.md");

/** De opdracht van de menukaart-controleur, zonder de kop met naam, model en gereedschap. */
export async function opdracht(pad = AGENT) {
  const tekst = await readFile(pad, "utf8");
  return tekst.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}

/** Het verzoek voor een geval: de opdracht, geval.json en de beelden die er zijn. */
export function verzoek(systeem, geval, beelden) {
  const inhoud = [{ type: "text", text: `geval.json:\n${JSON.stringify(geval, null, 1)}` }];
  for (const [naam, b64] of beelden) {
    inhoud.push({ type: "text", text: `${naam}:` }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } });
  }
  return { model: MODEL.model, temperature: 0, response_format: { type: "json_object" },
    messages: [{ role: "system", content: systeem }, { role: "user", content: inhoud }] };
}

/** Het oordeel uit het antwoord; zonder geldig oordeel geldt: prijs klopt niet. */
export function leesOordeel(tekst) {
  try {
    const o = JSON.parse(String(tekst).replace(/^```(json)?|```$/g, "").trim());
    if (typeof o.prijs_klopt !== "boolean") throw new Error("geen prijs_klopt");
    return { is_menukaart: !!o.is_menukaart, prijs_klopt: o.prijs_klopt, juiste_prijs: o.juiste_prijs ?? null, toelichting: String(o.toelichting ?? "") };
  } catch (e) {
    return { is_menukaart: false, prijs_klopt: false, juiste_prijs: null, toelichting: `onleesbaar antwoord van het model: ${e.message}` };
  }
}

async function gevallen(map) {
  const uit = [];
  for (const naam of await readdir(map)) {
    const p = join(map, naam);
    if (!(await stat(p)).isDirectory()) continue;
    if (existsSync(join(p, "geval.json"))) uit.push(p);
    else uit.push(...(await gevallen(p)));
  }
  return uit.sort();
}

async function kijkNa(map, systeem) {
  const geval = JSON.parse(await readFile(join(map, "geval.json"), "utf8"));
  const beelden = [];
  for (const naam of ["uitsnede.jpg", "foto.jpg"]) if (existsSync(join(map, naam))) beelden.push([naam, (await readFile(join(map, naam))).toString("base64")]);
  const res = await fetch(`${MODEL.url}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY || "via-proxy"}` },
    body: JSON.stringify(verzoek(systeem, geval, beelden)),
  });
  if (!res.ok) throw new Error(`${MODEL.model} gaf ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d = await res.json();
  return { ...leesOordeel(d.choices?.[0]?.message?.content), model: MODEL.model, tokens: [d.usage?.prompt_tokens, d.usage?.completion_tokens] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: o, positionals } = parseArgs({ allowPositionals: true, options: { opnieuw: { type: "boolean" }, uit: { type: "string", default: "oordeel.json" } } });
  if (!positionals[0]) { console.log("Gebruik: node deepseek-controleur.mjs nakijken/<datum> [--opnieuw] [--uit oordeel.json]"); process.exit(1); }
  const systeem = await opdracht();
  let goed = 0, fout = 0;
  for (const map of await gevallen(positionals[0])) {
    if (!o.opnieuw && existsSync(join(map, o.uit))) continue;
    try {
      const oordeel = await kijkNa(map, systeem);
      await writeFile(join(map, o.uit), JSON.stringify(oordeel, null, 1));
      oordeel.prijs_klopt ? goed++ : fout++;
      console.log(`${oordeel.prijs_klopt ? "goed" : "AF  "} ${map}: ${oordeel.toelichting}`);
    } catch (e) {
      console.log(`fout ${map}: ${e.message}`);
    }
  }
  console.log(`\n${goed} goedgekeurd, ${fout} afgekeurd`);
}
