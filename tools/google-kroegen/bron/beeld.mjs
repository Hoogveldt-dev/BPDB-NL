// Kleine beeldbewerking zonder native afhankelijkheden: JPEG lezen en schrijven met jpeg-js
// (puur JavaScript, werkt op Windows zonder installatie), en een perceptuele hash.
//
// dHash: verklein naar 9 bij 8 grijswaarden en vergelijk elke pixel met zijn rechterbuur.
// Twee foto's van dezelfde kaart (of dezelfde foto twee keer geupload) verschillen dan in
// hooguit een paar van de 64 bits; verschillende foto's in ongeveer de helft.

import { createRequire } from "node:module";

let jpegJs;
function jpeg() {
  if (jpegJs === undefined) {
    try {
      jpegJs = createRequire(import.meta.url)("jpeg-js");
    } catch {
      jpegJs = null;
    }
  }
  return jpegJs;
}

export const kanBeelden = () => jpeg() != null;

/** Leest een JPEG: { breedte, hoogte, data (RGBA) }, of null als het niet lukt. */
export function leesJpeg(buf) {
  const j = jpeg();
  if (!j || !buf?.length) return null;
  try {
    const b = j.decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024, formatAsRGBA: true });
    return { breedte: b.width, hoogte: b.height, data: b.data };
  } catch {
    return null;
  }
}

export function schrijfJpeg({ breedte, hoogte, data }, kwaliteit = 85) {
  return Buffer.from(jpeg().encode({ width: breedte, height: hoogte, data }, kwaliteit).data);
}

/** Grijswaarden, verkleind naar b bij h door te middelen over elk vak. */
export function grijsVerkleind(beeld, b, h) {
  const uit = new Float64Array(b * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * beeld.hoogte) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * beeld.hoogte) / h));
    for (let x = 0; x < b; x++) {
      const x0 = Math.floor((x * beeld.breedte) / b);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * beeld.breedte) / b));
      let som = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * beeld.breedte + xx) * 4;
          som += 0.299 * beeld.data[i] + 0.587 * beeld.data[i + 1] + 0.114 * beeld.data[i + 2];
        }
      }
      uit[y * b + x] = som / ((y1 - y0) * (x1 - x0));
    }
  }
  return uit;
}

/** dHash van 64 bits als BigInt, of null als de afbeelding niet te lezen is. */
export function dHash(buf) {
  const beeld = leesJpeg(buf);
  if (!beeld) return null;
  const g = grijsVerkleind(beeld, 9, 8);
  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) hash = (hash << 1n) | (g[y * 9 + x] > g[y * 9 + x + 1] ? 1n : 0n);
  }
  return hash;
}

export function hamming(a, b) {
  let v = a ^ b;
  let n = 0;
  while (v) {
    n += Number(v & 1n);
    v >>= 1n;
  }
  return n;
}

/** Bijna gelijk: hooguit zoveel bits verschil. */
export const BIJNA_GELIJK = 6;
