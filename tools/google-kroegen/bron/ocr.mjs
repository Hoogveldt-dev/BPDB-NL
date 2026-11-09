// OCR-voorfilter: staat er ergens een bedrag op de foto? Lokaal met tesseract.js
// (WebAssembly, werkt op Windows zonder installatie). Het Nederlandse taalpakket wordt bij
// de eerste run een keer gedownload naar .tesseract/ (niet in Git).
//
// Zonder bedrag is het geen kaart met prijzen, en hoeft de foto niet naar de modellen.
// Krijtborden en schuine foto's leest OCR slecht; daarom kan het filter ook alleen de
// volgorde bepalen (eerst foto's met een bedrag) in plaats van foto's weg te gooien.

import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CACHE = fileURLToPath(new URL("../.tesseract/", import.meta.url));

// € 3,90  3,90  4.00  3,-  3.-  3,5  (getallen van 1 tot 50; 0,5 l of 17.00 uur mogen ook, ruim is beter dan streng)
const BEDRAG = /(?:€\s*)?\b(\d{1,2})(?:[.,](\d{1,2})\b|[.,]\s?-)|€\s*(\d{1,2})\b/g;

/** De bedragen in een stuk tekst, als getallen in euro. */
export function vindBedragen(tekst) {
  const uit = [];
  for (const m of String(tekst || "").matchAll(BEDRAG)) {
    const heel = Number(m[1] ?? m[3]);
    const fractie = m[2] ? Number(m[2].padEnd(2, "0")) / 100 : 0;
    const bedrag = heel + fractie;
    if (bedrag >= 1 && bedrag <= 50) uit.push(Math.round(bedrag * 100) / 100);
  }
  return uit;
}

export class Ocr {
  constructor({ taal = "nld", log = () => {} } = {}) {
    this.taal = taal;
    this.log = log;
  }

  /** null als tesseract.js niet geinstalleerd is. */
  async #werker() {
    if (this.werker !== undefined) return this.werker;
    let tesseract;
    try {
      tesseract = createRequire(import.meta.url)("tesseract.js");
    } catch {
      this.log("    OCR: tesseract.js ontbreekt (npm install); foto's gaan zonder voorfilter naar het model");
      this.werker = null;
      return null;
    }
    mkdirSync(CACHE, { recursive: true }); // anders bewaart tesseract.js het taalpakket niet
    this.werker = await tesseract.createWorker(this.taal, 1, {
      cachePath: CACHE,
      logger: () => {},
      errorHandler: () => {},
    });
    return this.werker;
  }

  /** Bedragen op de foto, of null als OCR niet kon draaien. */
  async bedragen(beeld) {
    const w = await this.#werker();
    if (!w) return null;
    try {
      const { data } = await w.recognize(beeld);
      return vindBedragen(data.text);
    } catch (e) {
      this.log(`    OCR: ${e.message}`);
      return null;
    }
  }

  async sluit() {
    await this.werker?.terminate();
  }
}
