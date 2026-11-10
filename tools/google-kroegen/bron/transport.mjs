// Twee manieren om hetzelfde zoekantwoord op te halen, met dezelfde ontleding:
//
// 1. http: rechtstreeks fetch, snel en zonder browser (de "fast mode" van
//    gosom/google-maps-scraper).
// 2. browser: Playwright opent Google Maps, wijst cookies af en doet dezelfde
//    fetch vanuit de pagina, met de cookies en vingerafdruk van een echte browser.
//    Cookie-aanpak naar clickRejectCookiesIfRequired (gosom) en de consent-
//    afhandeling van conor-is-my-name/google-maps-scraper (beide MIT).
//
// "auto" begint met http en stapt over op de browser zodra Google blokkeert.

import { createRequire } from "node:module";

export class Geblokkeerd extends Error {}

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const BASIS = "https://www.google.com";
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

function lijktGeblokkeerd(status, body) {
  return status === 429 || status === 403 || /\/sorry\/|unusual traffic|captcha/i.test(body.slice(0, 5000));
}

export class HttpTransport {
  naam = "http";
  constructor({ pogingen = 4, log = () => {} } = {}) {
    this.pogingen = pogingen;
    this.log = log;
  }

  async haal(pad) {
    let laatste;
    for (let poging = 0; poging < this.pogingen; poging++) {
      if (poging > 0) await wacht(2000 * 2 ** (poging - 1)); // 2, 4, 8 s
      try {
        const res = await fetch(BASIS + pad, {
          headers: { "User-Agent": UA, "Accept-Language": "nl-NL,nl;q=0.9,en;q=0.5" },
          signal: AbortSignal.timeout(30000),
        });
        const body = await res.text();
        if (lijktGeblokkeerd(res.status, body)) {
          laatste = new Geblokkeerd(`Google blokkeert (HTTP ${res.status})`);
          if (res.status !== 429) break;
          continue;
        }
        if (res.status >= 500) {
          laatste = new Error(`HTTP ${res.status}`);
          continue;
        }
        return body;
      } catch (e) {
        laatste = e;
        this.log(`  http-poging ${poging + 1} mislukt: ${e.message}`);
      }
    }
    throw laatste;
  }

  async sluit() {}
}

export class BrowserTransport {
  naam = "browser";
  constructor({ log = () => {}, zichtbaar = false } = {}) {
    this.log = log;
    this.zichtbaar = zichtbaar;
    this.pagina = null;
  }

  async start() {
    let playwright;
    try {
      playwright = createRequire(import.meta.url)("playwright");
    } catch {
      throw new Error("Playwright ontbreekt. Installeer met: npm install && npx playwright install chromium");
    }
    this.browser = await playwright.chromium.launch({ channel: process.env.PLAYWRIGHT_KANAAL || undefined, headless: !this.zichtbaar });
    const ctx = await this.browser.newContext({ locale: "nl-NL", userAgent: UA, viewport: { width: 1280, height: 900 } });
    this.pagina = await ctx.newPage();
    await this.pagina.goto(`${BASIS}/maps?hl=nl`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await this.cookiesAfwijzen();
  }

  async cookiesAfwijzen() {
    const p = this.pagina;
    if (!/consent\.google/.test(p.url()) && !(await p.locator('form[action*="consent"]').count())) return;
    this.log("  cookiemelding: alles afwijzen");
    const knop = p.getByRole("button", { name: /Alles afwijzen|Reject all|Alle ablehnen/i }).first();
    if (await knop.count()) await knop.click();
    else await p.evaluate(() => document.querySelector('form[action*="consent"] button')?.click());
    await p.waitForURL(/google\.[a-z.]+\/maps/, { timeout: 20000 }).catch(() => {});
  }

  async haal(pad) {
    if (!this.pagina) await this.start();
    const { status, body } = await this.pagina.evaluate(async (u) => {
      const r = await fetch(u, { credentials: "include" });
      return { status: r.status, body: await r.text() };
    }, pad);
    if (lijktGeblokkeerd(status, body)) throw new Geblokkeerd(`Google blokkeert ook de browser (HTTP ${status})`);
    if (status >= 400) throw new Error(`HTTP ${status}`);
    return body;
  }

  async sluit() {
    await this.browser?.close();
  }
}

export class AutoTransport {
  constructor(opties = {}) {
    this.opties = opties;
    this.actief = new HttpTransport(opties);
  }

  get naam() {
    return `auto:${this.actief.naam}`;
  }

  async haal(pad) {
    try {
      return await this.actief.haal(pad);
    } catch (e) {
      if (!(e instanceof Geblokkeerd) || this.actief instanceof BrowserTransport) throw e;
      this.opties.log?.(`  ${e.message}; overstappen op de browser`);
      await this.actief.sluit();
      this.actief = new BrowserTransport(this.opties);
      return this.actief.haal(pad);
    }
  }

  async sluit() {
    await this.actief.sluit();
  }
}

export function maakTransport(soort, opties) {
  if (soort === "http") return new HttpTransport(opties);
  if (soort === "browser") return new BrowserTransport(opties);
  return new AutoTransport(opties);
}
