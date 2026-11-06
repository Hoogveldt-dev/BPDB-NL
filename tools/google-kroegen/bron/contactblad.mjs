// Contactblad: veel miniaturen in een afbeelding, elk met een nummer.
//
// Een vision-model rekent per afbeelding en per pixel. Een blad van 24 miniaturen
// van 160 px kost ongeveer evenveel als een enkele foto, en het model denkt een keer
// na in plaats van per groepje. Getekend in de browser die de tool toch al open heeft
// (geen extra afhankelijkheden).

export function bladHtml(beelden, { kolommen = 6, px = 160 } = {}) {
  const cellen = beelden
    .map((b, i) => `<div class="c"><img src="data:image/jpeg;base64,${b.toString("base64")}"><b>${i + 1}</b></div>`)
    .join("");
  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#fff}
    .g{display:grid;grid-template-columns:repeat(${kolommen},${px}px);gap:4px;padding:4px;width:max-content}
    .c{position:relative;width:${px}px;height:${px}px;background:#eee;overflow:hidden}
    img{width:100%;height:100%;object-fit:contain}
    b{position:absolute;left:0;top:0;background:#ff0;color:#000;font:bold 18px/1 sans-serif;padding:3px 5px}
  </style><div class="g">${cellen}</div>`;
}

/** Tekent het blad in een Playwright-pagina en geeft een JPEG terug. */
export async function maakBlad(pagina, beelden, opties = {}) {
  await pagina.setContent(bladHtml(beelden, opties), { waitUntil: "load" });
  const raster = await pagina.$(".g");
  return raster.screenshot({ type: "jpeg", quality: 80 });
}
