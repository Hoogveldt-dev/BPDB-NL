// Ontleedt het JSON-antwoord van /search?tbm=map naar plaatsen.
// Indexpaden komen uit gmaps/multiple.go en gmaps/entry.go van
// gosom/google-maps-scraper (MIT, (c) 2023 Georgios Komninos), op 6 november 2026
// gecontroleerd tegen live antwoorden voor Nijmegen. Afwijkingen van gosom:
// - openingstijden staan in [203][0] (gosom leest hier [34][1]);
// - [88][0] is in zoekresultaten geen sluitstatus, dus alleen exacte statuswaarden tellen;
// - Google laat definitief gesloten zaken weg uit zoekresultaten. "Gesloten" leiden we
//   daarom af uit "bij volledige runs niet meer gezien" (zie de database-functie).

import { pad, tekst, getal, lijst } from "./pad.mjs";

export class OnverwachtAntwoord extends Error {}

const PREFIX = ")]}'";

export function ontleedZoekantwoord(ruw) {
  let body = String(ruw ?? "").trimStart();
  if (!body.startsWith(PREFIX)) throw new OnverwachtAntwoord("Antwoord begint niet met )]}' (geblokkeerd of ander formaat)");
  body = body.slice(PREFIX.length);
  let data;
  try {
    data = JSON.parse(body);
  } catch (e) {
    throw new OnverwachtAntwoord(`Geen geldige JSON: ${e.message}`);
  }
  const items = pad(data, 0, 1);
  if (items === undefined) return [];
  if (!Array.isArray(items)) throw new OnverwachtAntwoord("Lijst met resultaten ontbreekt op [0][1]");
  const plaatsen = [];
  for (const item of items.slice(1)) {
    const zaak = pad(item, 14);
    if (!Array.isArray(zaak)) continue;
    plaatsen.push(plaatsUitZaak(zaak));
  }
  return plaatsen;
}

const STATUS = new Set(["CLOSED", "PERMANENTLY_CLOSED", "TEMPORARILY_CLOSED"]);

export function plaatsUitZaak(z) {
  const dataId = tekst(pad(z, 10));
  const adresregels = lijst(pad(z, 2)).filter((r) => typeof r === "string");
  const { postcode, plaats } = postcodeEnPlaats(adresregels[1]);
  const statusRuw = [pad(z, 88, 0), pad(z, 34, 4, 4)].find((s) => typeof s === "string" && STATUS.has(s));
  // Bewust niet: beoordeling, reviews en telefoon. De website gaat niet naar de database, maar helpt drankkaarten.py.
  return {
    place_id: tekst(pad(z, 78)),
    data_id: dataId,
    naam: schoneNaam(tekst(pad(z, 11))),
    naam_google: tekst(pad(z, 11)),
    categorieen: lijst(pad(z, 13)).filter((c) => typeof c === "string"),
    adres: tekst(adresregels[0]),
    postcode,
    plaats,
    lat: getal(pad(z, 9, 2)),
    lon: getal(pad(z, 9, 3)),
    openingstijden: openingstijden(z),
    status: statusRuw ?? null,
    website: tekst(pad(z, 7, 0)) ?? null,
  };
}

/** Emoji's die eigenaren aan hun naam plakken ("Café Daen🍺") eruit; de rest blijft. */
export function schoneNaam(naam) {
  if (!naam) return null;
  const s = naam.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim();
  return s || naam;
}

function postcodeEnPlaats(regel) {
  const m = /^(\d{4}\s?[A-Z]{2})\s+(.+)$/.exec(regel ?? "");
  return m ? { postcode: m[1].replace(/\s/, " "), plaats: m[2].trim() } : { postcode: null, plaats: tekst(regel) };
}

export const DAGEN = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];

/**
 * Openingstijden in de vorm die de database verwacht: per dag een lijst als ["16:00-02:00"],
 * een lege lijst is gesloten. Google schrijft "16:00–02:00", "Gesloten" of "24 uur geopend".
 * Is iets onbekend, dan liever geen openingstijden dan verkeerde.
 */
export function normaliseerTijden(ruw) {
  if (!ruw) return null;
  const uit = {};
  for (const [dag, waarden] of Object.entries(ruw)) {
    const d = dag.toLowerCase();
    if (!DAGEN.includes(d)) return null;
    const lijst = [];
    for (const w of waarden) {
      const t = w.trim().toLowerCase();
      if (t === "gesloten") continue;
      if (/^24 uur geopend$|^open 24 hours$/.test(t)) { lijst.push("00:00-24:00"); continue; }
      const m = /^(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})$/.exec(t);
      if (!m) return null;
      lijst.push(`${m[1].padStart(2, "0")}:${m[2]}-${m[3].padStart(2, "0")}:${m[4]}`);
    }
    uit[d] = lijst;
  }
  return DAGEN.every((d) => d in uit) ? uit : null;
}

function openingstijden(z) {
  // Nieuw (2025 en later): [203][0] = [[dag, nr, datum, [[tekst, ...]], ...], ...]
  // Oud: [34][1] = [[dag, [tekst, ...]], ...]
  const ruw = {};
  for (const d of lijst(pad(z, 203, 0))) {
    const dag = tekst(pad(d, 0));
    if (dag) ruw[dag] = lijst(pad(d, 3)).map((s) => tekst(pad(s, 0))).filter(Boolean);
  }
  if (!Object.keys(ruw).length) {
    for (const d of lijst(pad(z, 34, 1))) {
      const dag = tekst(pad(d, 0));
      if (dag) ruw[dag] = lijst(pad(d, 1)).map(tekst).filter(Boolean);
    }
  }
  return Object.keys(ruw).length ? normaliseerTijden(ruw) : null;
}
