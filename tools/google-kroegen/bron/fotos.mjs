// De fotolijst van een plaats in Google Maps.
//
// Google Maps haalt de foto's van een plaats op met de RPC "hspqX" (batchexecute).
// Elk antwoord bevat 10 foto's, het totaal en een token voor de volgende pagina.
// Per foto lezen we:
//   [0]        foto-ID
//   [2]        soort: 12 foto, 10 video, 11 Street View
//   [6][0]     URL op lh3.googleusercontent.com (met grootte-achtervoegsel "=w..")
//   [6][2]     breedte en hoogte van het origineel
//   [21][6][0] 1 eigenaar, 2 bezoeker
//   [21][6][5][2] waarmee geupload, bijvoorbeeld "photos:gmm_android_review_post"
//   [21][6][8] uploaddatum [jaar, maand, dag, uur]
//
// Achter de URL zet je de gewenste grootte: "=w256" voor een miniatuur, "=s0" voor
// het origineel. Het origineel bevat de EXIF-gegevens van de maker, met de datum
// waarop de foto genomen is (zie exif.mjs).

import { pad } from "./pad.mjs";

export const SOORT = { 10: "video", 11: "streetview", 12: "foto" };

const KOLOMMEN = [[1, 0, 3], [2, 1, 2], [2, 0, 3], [8, 0, 3], [10, 0, 3], [10, 1, 2], [10, 0, 4], [9, 1, 2]];

/** Formulierdata voor een pagina van de fotolijst. */
export function fotolijstVerzoek(dataId, token = null) {
  const args = [2, null, [dataId, null, null, null, null, null, null, null, 0], null,
    [null, [203, 100], [null, 20, token, null, 1], null, null, null, [KOLOMMEN, 1], null, 0, null, null, null, null, null,
      [[[[[[2]]], [195, 195], 20]]]],
    null, null, null, null, null, null, null, null, null, null, [null, 1, null, 1]];
  return "f.req=" + encodeURIComponent(JSON.stringify([[["hspqX", JSON.stringify(args), null, "generic"]]])) + "&";
}

export const FOTOLIJST_PAD = "/maps/_/MapsWizUi/data/batchexecute?rpcids=hspqX&source-path=%2Fmaps%2Fplace%2F&hl=nl&rt=c";

export class FotolijstOnleesbaar extends Error {}

const datum = (d) =>
  Array.isArray(d) && d.length >= 3 ? `${d[0]}-${String(d[1]).padStart(2, "0")}-${String(d[2]).padStart(2, "0")}` : null;

/** Leest een antwoord van hspqX: { fotos, totaal, token }. */
export function ontleedFotolijst(tekst) {
  const regel = tekst.split("\n").find((r) => r.startsWith('[["wrb.fr","hspqX"'));
  if (!regel) throw new FotolijstOnleesbaar("Geen fotolijst in het antwoord van Google");
  const buiten = JSON.parse(regel);
  if (!buiten[0][2]) return { fotos: [], totaal: 0, token: null };
  const binnen = JSON.parse(buiten[0][2]);
  const fotos = (binnen[0] || []).map((x) => {
    const url = pad(x, 6, 0);
    const meta = pad(x, 21, 6);
    return {
      id: x[0],
      soort: SOORT[x[2]] || String(x[2]),
      url: typeof url === "string" ? url.split("=")[0] : null,
      breedte: pad(x, 6, 2, 0) ?? null,
      hoogte: pad(x, 6, 2, 1) ?? null,
      door: pad(meta, 0) === 1 ? "eigenaar" : pad(meta, 0) === 2 ? "bezoeker" : null,
      bron: pad(meta, 5, 2) ?? null,
      geupload: datum(pad(meta, 8)),
    };
  });
  return { fotos, totaal: typeof binnen[1] === "number" ? binnen[1] : null, token: binnen[5] || null };
}

export const miniatuur = (url, px = 256) => `${url}=w${px}-h${px}-k-no`;
export const leesbaar = (url, px = 1600) => `${url}=w${px}`;
export const origineel = (url) => `${url}=s0`;
