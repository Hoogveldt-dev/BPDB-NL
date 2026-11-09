// Haalt de fotolijst van een plaats op via een browser (Playwright).
//
// De fotolijst-RPC werkt alleen met de cookies van een Google Maps-pagina. We openen
// daarom de plaats in Google Maps, wijzen cookies af en doen de aanroepen vanuit die
// pagina. Een gewone (niet-headless) browserkenmerk is nodig: Google toont een
// headless browser alleen een beperkte weergave.
//
// Google stuurt bij te veel verzoeken naar een CAPTCHA (/sorry/). Dan stoppen we
// meteen met Geblokkeerd: geen nieuwe pogingen, de CAPTCHA lossen we niet op.
// Draai dit vanaf een thuisverbinding; IP-adressen van datacenters worden snel geblokkeerd.

import { createRequire } from "node:module";
import { Geblokkeerd } from "./transport.mjs";
import { FOTOLIJST_PAD, fotolijstVerzoek, ontleedFotolijst } from "./fotos.mjs";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const spreid = (ms) => ms * (0.8 + Math.random() * 0.6);

export class FotoBron {
  constructor({ log = () => {}, zichtbaar = false, pauzeMs = 3000 } = {}) {
    this.log = log;
    this.zichtbaar = zichtbaar;
    this.pauzeMs = pauzeMs;
  }

  async start() {
    let playwright;
    try {
      playwright = createRequire(import.meta.url)("playwright");
    } catch {
      throw new Error("Playwright ontbreekt. Installeer met: npm install && npx playwright install chromium");
    }
    this.browser = await playwright.chromium.launch({
      headless: !this.zichtbaar,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    const ctx = await this.browser.newContext({ locale: "nl-NL", userAgent: UA, viewport: { width: 1400, height: 900 } });
    this.pagina = await ctx.newPage();
  }

  geblokkeerd() {
    return this.pagina.url().includes("/sorry/");
  }

  async cookiesAfwijzen() {
    const p = this.pagina;
    if (!/consent\.google/.test(p.url()) && !(await p.locator('form[action*="consent"]').count())) return;
    const knop = p.getByRole("button", { name: /Alles afwijzen|Reject all|Alle ablehnen/i }).first();
    if (await knop.count()) await knop.click();
    await p.waitForURL(/google\.[a-z.]+\/maps/, { timeout: 20000 }).catch(() => {});
  }

  /** Opent de plaats en geeft het data-ID ("0x...:0x...") terug. */
  async openPlaats(placeId) {
    if (!this.pagina) await this.start();
    const p = this.pagina;
    await p.goto(`https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}&hl=nl`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await this.cookiesAfwijzen();
    if (this.geblokkeerd()) throw new Geblokkeerd("Google toont een CAPTCHA; stop en probeer het later (vanaf een thuisverbinding)");
    const eind = Date.now() + 25000;
    while (Date.now() < eind) {
      const m = /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/.exec(decodeURIComponent(p.url()));
      if (m) return m[1];
      if (this.geblokkeerd()) throw new Geblokkeerd("Google toont een CAPTCHA");
      await wacht(500);
    }
    throw new Error(`Plaats ${placeId} niet gevonden in Google Maps (pagina: ${p.url().slice(0, 120)})`);
  }

  /** Alle foto's van een plaats (pagina's van 10), tot maxFotos of tot klaar(fotos) true geeft. */
  async fotolijst(dataId, { maxFotos = 400, klaar = null } = {}) {
    const alle = [];
    const gezien = new Set();
    let token = null;
    let totaal = null;
    while (alle.length < maxFotos) {
      const { status, tekst } = await this.pagina.evaluate(
        async ({ pad, body }) => {
          const r = await fetch(pad, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
            body,
          });
          return { status: r.status, tekst: await r.text() };
        },
        { pad: FOTOLIJST_PAD, body: fotolijstVerzoek(dataId, token) },
      );
      if (status === 429 || /\/sorry\//.test(tekst.slice(0, 3000))) throw new Geblokkeerd(`Google blokkeert de fotolijst (HTTP ${status})`);
      if (status >= 400) throw new Error(`Fotolijst gaf HTTP ${status}`);
      const pagina = ontleedFotolijst(tekst);
      totaal = pagina.totaal ?? totaal;
      const nieuw = pagina.fotos.filter((f) => !gezien.has(f.id));
      for (const f of nieuw) {
        gezien.add(f.id);
        alle.push(f);
      }
      this.log(`    foto's: ${alle.length}${totaal ? ` van ${totaal}` : ""}`);
      if (klaar?.(alle) || !nieuw.length || !pagina.token || pagina.token === token) break;
      token = pagina.token;
      await wacht(spreid(this.pauzeMs));
    }
    return alle;
  }

  async sluit() {
    await this.browser?.close();
  }
}
