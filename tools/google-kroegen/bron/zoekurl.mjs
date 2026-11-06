// De zoek-URL die de Google Maps-webapp zelf gebruikt (tbm=map). Het antwoord is
// JSON, dus er is geen browser of HTML-ontleding nodig.
// De pb-parameter komt uit buildGoogleMapsParams van gosom/google-maps-scraper
// (MIT, (c) 2023 Georgios Komninos). Toegevoegd: paginering via !8i<offset>
// (gosom haalt alleen de eerste 20 op) en het land via gl.

export const PER_PAGINA = 20;

export function zoekPad({ zoekterm, lat, lon, zoom, offset = 0, taal = "nl", land = "nl" }) {
  const pb =
    `!4m12!1m3!1d3826.902183192154!2d${lon.toFixed(4)}!3d${lat.toFixed(4)}` +
    `!2m3!1f0!2f0!3f0!3m2!1i600!2i800!4f${zoom.toFixed(1)}!7i${PER_PAGINA}!8i${offset}` +
    "!10b1!12m22!1m3!18b1!30b1!34e1!2m3!5m1!6e2!20e3!4b0!10b1!12b1!13b1!16b1!17m1!3e1" +
    "!20m3!5e2!6b1!14b1!46m1!1b0!96b1!19m4!2m3!1i360!2i120!4i8";
  const params = new URLSearchParams({ tbm: "map", authuser: "0", hl: taal, gl: land, q: zoekterm, pb });
  return `/search?${params}`;
}
