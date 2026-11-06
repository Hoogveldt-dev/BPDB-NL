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
  return {
    place_id: tekst(pad(z, 78)),
    data_id: dataId,
    cid: cidUitDataId(dataId),
    naam: schoneNaam(tekst(pad(z, 11))),
    naam_google: tekst(pad(z, 11)),
    categorieen: lijst(pad(z, 13)).filter((c) => typeof c === "string"),
    adres: tekst(adresregels[0]),
    postcode,
    plaats,
    lat: getal(pad(z, 9, 2)),
    lon: getal(pad(z, 9, 3)),
    beoordeling: getal(pad(z, 4, 7)),
    aantal_reviews: getal(pad(z, 4, 8)),
    prijsniveau: tekst(pad(z, 4, 2)),
    telefoon: tekst(pad(z, 178, 0, 0)),
    website: echteUrl(tekst(pad(z, 7, 0))),
    openingstijden: openingstijden(z),
    status: statusRuw ?? null,
  };
}

/** data_id is "0x<cel>:0x<cid>"; het tweede deel is de decimale CID uit maps.google.com/?cid= */
export function cidUitDataId(dataId) {
  const m = /^0x[0-9a-f]+:(0x[0-9a-f]+)$/i.exec(dataId ?? "");
  return m ? BigInt(m[1]).toString() : null;
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

function echteUrl(u) {
  if (!u) return null;
  if (u.startsWith("/url?")) {
    const q = new URLSearchParams(u.slice(5)).get("q");
    return q || null;
  }
  return u;
}

function openingstijden(z) {
  // Nieuw (2025 en later): [203][0] = [[dag, nr, datum, [[tekst, ...]], ...], ...]
  // Oud: [34][1] = [[dag, [tekst, ...]], ...]
  const nieuw = lijst(pad(z, 203, 0));
  const uit = {};
  for (const d of nieuw) {
    const dag = tekst(pad(d, 0));
    if (!dag) continue;
    uit[dag] = lijst(pad(d, 3)).map((s) => tekst(pad(s, 0))).filter(Boolean);
  }
  if (Object.keys(uit).length) return uit;
  for (const d of lijst(pad(z, 34, 1))) {
    const dag = tekst(pad(d, 0));
    if (dag) uit[dag] = lijst(pad(d, 1)).map(tekst).filter(Boolean);
  }
  return Object.keys(uit).length ? uit : null;
}
