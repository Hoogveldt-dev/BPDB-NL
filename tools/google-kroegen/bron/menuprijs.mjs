// JAN-methode, automatisch: van de foto's van een plaats naar een vaasjesprijs met datum.
//
// 1. Alleen foto's (geen video of Street View), nieuwste upload eerst, optioneel vanaf een datum.
// 2. Miniaturen in groepjes naar het model: welke tonen een kaart met prijzen?
// 3. Van de nieuwste kandidaten het origineel ophalen: datum uit EXIF (opname),
//    anders de uploaddatum. Een leesbare versie gaat naar het model.
// 4. kiesVaasje: goedkoopste pils van de tap, 25 cl. De kaart met de nieuwste datum wint.

import { exifDatum } from "./exif.mjs";
import { leesbaar, miniatuur, origineel } from "./fotos.mjs";
import { herkenMenus, leesKaart } from "./menulezer.mjs";
import { kiesVaasje } from "./vaasje.mjs";

export async function zoekMenuprijs(fotos, {
  haalBeeld,
  herken = herkenMenus,
  lees = leesKaart,
  sinds = null,
  groep = 10,
  maxKandidaten = 4,
  log = () => {},
} = {}) {
  const kandidaatFotos = fotos
    .filter((f) => f.soort === "foto" && f.url && (!sinds || (f.geupload && f.geupload >= sinds)))
    .sort((a, b) => (b.geupload || "").localeCompare(a.geupload || ""));

  const menus = [];
  for (let i = 0; i < kandidaatFotos.length; i += groep) {
    const deel = kandidaatFotos.slice(i, i + groep);
    const miniaturen = await Promise.all(deel.map((f) => haalBeeld(miniatuur(f.url))));
    const treffers = await herken(miniaturen, { log });
    for (const t of treffers) menus.push(deel[t]);
  }
  log(`    ${kandidaatFotos.length} foto's bekeken, ${menus.length} lijken op een kaart`);

  const uitkomsten = [];
  for (const f of menus.slice(0, maxKandidaten)) {
    const opname = exifDatum(await haalBeeld(origineel(f.url)));
    const { bieren, datumOpKaart } = await lees(await haalBeeld(leesbaar(f.url)), { log });
    const vaasje = kiesVaasje(bieren);
    const datum = opname || f.geupload;
    log(`    kaart ${f.id.slice(-8)}: ${bieren.length} bieren, ${vaasje ? `${vaasje.merk} ${(vaasje.prijs_cent / 100).toFixed(2)}` : "geen vaasje"}, ${opname ? `opname ${opname}` : `geupload ${f.geupload}`}`);
    if (vaasje && datum) {
      uitkomsten.push({ ...vaasje, datum, datumBron: opname ? "opname" : "upload", datumOpKaart, foto: f });
    }
  }
  uitkomsten.sort((a, b) => b.datum.localeCompare(a.datum) || a.prijs_cent - b.prijs_cent);
  return { prijs: uitkomsten[0] || null, bekeken: kandidaatFotos.length, kaarten: menus.length, uitkomsten };
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
