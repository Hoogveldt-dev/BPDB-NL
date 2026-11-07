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

import { exifDatum } from "./exif.mjs";
import { leesbaar, miniatuur, origineel } from "./fotos.mjs";
import { heeftBierprijzen, herkenMenus, leesKaart } from "./menulezer.mjs";
import { kiesVaasje } from "./vaasje.mjs";

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
  log = () => {},
} = {}) {
  const kandidaatFotos = fotos
    .filter((f) => f.soort === "foto" && f.url && (!sinds || (f.geupload && f.geupload >= sinds)))
    .sort((a, b) => (b.geupload || "").localeCompare(a.geupload || ""));

  let bekeken = 0;
  let kaarten = 0;
  let gelezen = 0;
  let gecontroleerd = 0;
  const uitkomsten = [];
  const twijfels = [];
  for (let i = 0; i < kandidaatFotos.length && gelezen < maxKandidaten; i += groep) {
    const deel = kandidaatFotos.slice(i, i + groep);
    const miniaturen = await Promise.all(deel.map((f) => haalBeeld(miniatuur(f.url))));
    bekeken += deel.length;
    const treffers = (await herken(miniaturen, { log })).map((t) => deel[t]).filter(Boolean);
    kaarten += treffers.length;
    log(`    foto ${i + 1} tot ${i + deel.length}: ${treffers.length} lijken op een kaart`);

    for (const f of treffers) {
      if (gelezen >= maxKandidaten || gecontroleerd >= maxKandidaten * 4) break;
      gecontroleerd += 1;
      if (!(await controleer(await haalBeeld(leesbaar(f.url, 768)), { log }))) continue;
      gelezen += 1;
      const opname = exifDatum(await haalBeeld(origineel(f.url)));
      const { bieren, datumOpKaart } = await lees(await haalBeeld(leesbaar(f.url)), { log });
      const vaasje = kiesVaasje(bieren);
      const datum = opname || f.geupload;
      log(`    kaart ${f.id.slice(-8)}: ${bieren.length} bieren, ${vaasje ? `${vaasje.merk} ${(vaasje.prijs_cent / 100).toFixed(2)}` : "geen vaasje"}, ${opname ? `opname ${opname}` : `geupload ${f.geupload}`}`);
      if (!vaasje || !datum) continue;
      const uitkomst = { ...vaasje, datum, datumBron: opname ? "opname" : "upload", datumOpKaart, foto: f };
      if (bevestig) {
        const tweede = await bevestig(await haalBeeld(leesbaar(f.url)), vaasje, { log });
        if (!tweede.klopt) {
          log(`    tweede mening: klopt niet${tweede.prijsOpKaart ? ` (ziet ${tweede.prijsOpKaart})` : ""}; naar twijfels`);
          twijfels.push({ ...uitkomst, tweedePrijs: tweede.prijsOpKaart });
          continue;
        }
        log("    tweede mening: klopt");
      }
      uitkomsten.push(uitkomst);
    }
    if (uitkomsten.length && !volledig) break;
  }
  uitkomsten.sort((a, b) => b.datum.localeCompare(a.datum) || a.prijs_cent - b.prijs_cent);
  return { prijs: uitkomsten[0] || null, bekeken, kaarten, gecontroleerd, gelezen, uitkomsten, twijfels };
}

/** Een rij voor importeer_menuprijzen. */
export function naarMenuImport(placeId, p) {
  const wanneer = p.datumBron === "opname" ? `genomen ${p.datum}` : `geupload ${p.datum}`;
  return {
    google_place_id: placeId,
    merk: p.merk,
    volume_cl: p.volume_cl,
    prijs_cent: p.prijs_cent,
    datum: p.datum,
    bron_omschrijving: `Foto van de kaart in Google Maps, ${wanneer}`,
  };
}
