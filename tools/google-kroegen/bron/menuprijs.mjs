// JAN-methode, automatisch: van de foto's van een plaats naar een vaasjesprijs met datum.
//
// 1. Alleen foto's (geen video of Street View), nieuwste upload eerst, optioneel vanaf een datum.
// 2. Schiften, ruim: per groep van 20 miniaturen een contactblad naar het model,
//    zonder nadenken. Op welke foto's is een kaart of krijtbord te zien?
// 3. Controleren, streng: per kandidaat een middelgrote versie, zonder nadenken:
//    staan er bierprijzen op die je kunt lezen? Zo vallen QR-bordjes en sfeerfoto's af.
// 4. Lezen, alleen wat de controle doorstaat, met (laag) nadenken. Datum uit EXIF
//    (opname) van het origineel, anders de uploaddatum.
// 5. kiesVaasje: goedkoopste pils van de tap, 25 cl.
// 6. Zodra een groep een vaasjesprijs oplevert, stoppen we. Met volledig: true niet.
// 7. Optioneel een tweede mening (bevestig): een ander model kijkt of de gekozen prijs echt op de
//    kaart staat. Zegt het geen duidelijk ja, dan gaat de prijs naar twijfels en niet naar de uitkomst.
//
// Gemeten bij Cafe Van Buren en St Anneke (november 2026): schiften en controleren
// kosten samen ongeveer 1.000 tokens in en 20 uit per foto die door de schifting
// komt; lezen met nadenken kost 3.500 tot 4.000 tokens per kaart en gebeurt alleen
// nog bij foto's waarop echt bierprijzen staan.
//
// Goedkope filters voor de modellen (zonder model):
// - Dubbele foto's: een dHash per miniatuur; een foto die bijna gelijk is aan een nieuwere foto
//   van dezelfde kroeg slaan we over. Omdat we nieuwste eerst bekijken, blijft de nieuwste over.
// - OCR: een foto zonder enig bedrag gaat niet naar de modellen (ocrModus "filter"), of pas als
//   de foto's met een bedrag niets opleverden (ocrModus "volgorde").
// - Vaste controles: een prijs buiten EUR 2,00 tot 7,50 gaat naar twijfels; een EXIF-datum na de
//   upload of in de toekomst wordt de uploaddatum; een foto ouder dan tien jaar wordt gemarkeerd.

import { exifDatum } from "./exif.mjs";
import { leesbaar, miniatuur, origineel } from "./fotos.mjs";
import { heeftBierprijzen, herkenMenus, leesKaart } from "./menulezer.mjs";
import { kiesVaasje } from "./vaasje.mjs";
import { BIJNA_GELIJK, dHash, hamming } from "./beeld.mjs";
import { kiesDatum, prijsBuitenBereik } from "./controles.mjs";

/** Onthoudt opgehaalde beelden binnen een kroeg, zodat OCR en controle dezelfde 768 px delen. */
function onthoud(haalBeeld) {
  const cache = new Map();
  return (url) => {
    if (!cache.has(url)) cache.set(url, haalBeeld(url).catch((e) => { cache.delete(url); throw e; }));
    return cache.get(url);
  };
}

export async function zoekMenuprijs(fotos, {
  haalBeeld,
  herken = herkenMenus,
  controleer = heeftBierprijzen,
  lees = leesKaart,
  bevestig = null,
  sinds = null,
  groep = 20,
  maxKandidaten = 6,
  volledig = false,
  ontdubbel = true,
  hash = dHash,
  ocr = null,
  ocrModus = "volgorde",
  vandaag = undefined,
  log = () => {},
} = {}) {
  const kandidaatFotos = fotos
    .filter((f) => f.soort === "foto" && f.url && (!sinds || (f.geupload && f.geupload >= sinds)))
    .sort((a, b) => (b.geupload || "").localeCompare(a.geupload || ""));
  const haal = onthoud(haalBeeld);

  const tel = { bekeken: 0, dubbel: 0, zonderBedrag: 0, kaarten: 0, gecontroleerd: 0, gelezen: 0 };
  const uitkomsten = [];
  const twijfels = [];
  const hashes = [];
  const later = [];

  async function verwerk(deel, metOcr, van) {
    let over = deel.map((f, i) => ({ f, i }));
    const miniaturen = await Promise.all(deel.map((f) => haal(miniatuur(f.url))));
    if (metOcr) tel.bekeken += deel.length; // de tweede ronde is al geteld
    if (ontdubbel && metOcr) {
      over = over.filter(({ f, i }) => {
        const h = hash(miniaturen[i]);
        if (h == null) return true;
        const zelfde = hashes.find((x) => hamming(x.hash, h) <= BIJNA_GELIJK);
        if (zelfde) {
          zelfde.foto.dubbelen = [...(zelfde.foto.dubbelen || []), f.id];
          tel.dubbel += 1;
          return false;
        }
        hashes.push({ hash: h, foto: f });
        return true;
      });
    }
    if (ocr && metOcr) {
      const metBedrag = [];
      for (const x of over) {
        const bedragen = await ocr.bedragen(await haal(leesbaar(x.f.url, 768)));
        if (bedragen === null || bedragen.length) metBedrag.push(x);
        else {
          tel.zonderBedrag += 1;
          if (ocrModus === "volgorde") later.push(x.f);
        }
      }
      over = metBedrag;
    }
    if (!over.length) return;
    const treffers = (await herken(over.map((x) => miniaturen[x.i]), { log })).map((t) => over[t]?.f).filter(Boolean);
    tel.kaarten += treffers.length;
    log(`    foto ${van + 1} tot ${van + deel.length}: ${over.length} naar het model, ${treffers.length} lijken op een kaart`);

    for (const f of treffers) {
      if (tel.gelezen >= maxKandidaten || tel.gecontroleerd >= maxKandidaten * 4) break;
      tel.gecontroleerd += 1;
      if (!(await controleer(await haal(leesbaar(f.url, 768)), { log }))) continue;
      tel.gelezen += 1;
      const opname = exifDatum(await haal(origineel(f.url)));
      const { bieren, datumOpKaart } = await lees(await haal(leesbaar(f.url)), { log });
      const vaasje = kiesVaasje(bieren);
      const d = kiesDatum({ opname, geupload: f.geupload, vandaag });
      log(`    kaart ${f.id.slice(-8)}: ${bieren.length} bieren, ${vaasje ? `${vaasje.merk} ${(vaasje.prijs_cent / 100).toFixed(2)}` : "geen vaasje"}, ${opname ? `opname ${opname}` : `geupload ${f.geupload}`}`);
      for (const o of d.opmerkingen) log(`    let op: ${o}`);
      if (!vaasje || !d.datum) continue;
      const uitkomst = { ...vaasje, datum: d.datum, datumBron: d.datumBron, klokFout: d.klokFout, oud: d.oud, opmerkingen: d.opmerkingen, datumOpKaart, foto: f };
      const buiten = prijsBuitenBereik(vaasje.prijs_cent);
      if (buiten) {
        log(`    ${buiten}; naar twijfels`);
        twijfels.push({ ...uitkomst, reden: buiten });
        continue;
      }
      if (bevestig) {
        const tweede = await bevestig(await haal(leesbaar(f.url)), vaasje, { log });
        if (!tweede.klopt) {
          log(`    tweede mening: klopt niet${tweede.prijsOpKaart ? ` (ziet ${tweede.prijsOpKaart})` : ""}; naar twijfels`);
          twijfels.push({ ...uitkomst, tweedePrijs: tweede.prijsOpKaart, reden: "tweede mening oneens" });
          continue;
        }
        log("    tweede mening: klopt");
      }
      uitkomsten.push(uitkomst);
    }
  }

  const klaar = () => tel.gelezen >= maxKandidaten || (uitkomsten.length && !volledig);
  for (let i = 0; i < kandidaatFotos.length && !klaar(); i += groep) await verwerk(kandidaatFotos.slice(i, i + groep), true, i);
  // Volgorde: de foto's zonder bedrag pas als de foto's met een bedrag niets opleverden.
  if (later.length && !klaar()) log(`    nu de ${later.length} foto's waarop OCR geen bedrag vond`);
  for (let i = 0; i < later.length && !klaar(); i += groep) await verwerk(later.slice(i, i + groep), false, i);
  if (tel.dubbel || tel.zonderBedrag) log(`    ${tel.dubbel} dubbele foto's overgeslagen, ${tel.zonderBedrag} zonder bedrag`);
  uitkomsten.sort((a, b) => b.datum.localeCompare(a.datum) || a.prijs_cent - b.prijs_cent);
  return { prijs: uitkomsten[0] || null, ...tel, uitkomsten, twijfels };
}

/** Een rij voor importeer_menuprijzen. */
export function naarMenuImport(placeId, p) {
  const wanneer = p.datumBron === "opname" ? `genomen ${p.datum}` : `geupload ${p.datum}`;
  const extra = [p.klokFout && "datum van de camera klopte niet", p.oud && "foto ouder dan tien jaar"].filter(Boolean);
  return {
    google_place_id: placeId,
    merk: p.merk,
    volume_cl: p.volume_cl,
    prijs_cent: p.prijs_cent,
    datum: p.datum,
    bron_omschrijving: `Foto van de kaart in Google Maps, ${wanneer}${extra.length ? ` (${extra.join(", ")})` : ""}`,
  };
}
