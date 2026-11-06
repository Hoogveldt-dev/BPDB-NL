// Datum van opname uit de EXIF-gegevens van een JPEG, zonder afhankelijkheden.
//
// Volgorde: DateTimeOriginal (0x9003, moment van de foto), dan DateTimeDigitized
// (0x9004), dan DateTime (0x0132, laatst gewijzigd). Geeft "JJJJ-MM-DD" of null.

const SOI = 0xffd8;

export function exifDatum(buf) {
  if (!buf || buf.length < 4 || buf.readUInt16BE(0) !== SOI) return null;
  let p = 2;
  while (p + 4 <= buf.length) {
    if (buf[p] !== 0xff) return null;
    const marker = buf[p + 1];
    if (marker === 0xda || marker === 0xd9) return null; // beeldgegevens: geen EXIF meer
    const lengte = buf.readUInt16BE(p + 2);
    if (marker === 0xe1 && buf.toString("latin1", p + 4, p + 10) === "Exif\0\0") {
      return uitTiff(buf.subarray(p + 10, p + 2 + lengte));
    }
    p += 2 + lengte;
  }
  return null;
}

function uitTiff(t) {
  if (t.length < 8) return null;
  const le = t.toString("latin1", 0, 2) === "II";
  const u16 = (o) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
  const u32 = (o) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));

  const leesIfd = (start) => {
    const tags = new Map();
    if (start + 2 > t.length) return tags;
    const n = u16(start);
    for (let i = 0; i < n; i++) {
      const e = start + 2 + i * 12;
      if (e + 12 > t.length) break;
      const tag = u16(e);
      const type = u16(e + 2);
      const aantal = u32(e + 4);
      if (type === 2) {
        const off = aantal <= 4 ? e + 8 : u32(e + 8);
        if (off + aantal <= t.length) tags.set(tag, t.toString("latin1", off, off + aantal).replace(/\0+$/, ""));
      } else if (type === 4 || type === 13) {
        tags.set(tag, u32(e + 8));
      }
    }
    return tags;
  };

  try {
    const ifd0 = leesIfd(u32(4));
    const exifPtr = ifd0.get(0x8769);
    const sub = typeof exifPtr === "number" ? leesIfd(exifPtr) : new Map();
    for (const w of [sub.get(0x9003), sub.get(0x9004), ifd0.get(0x0132)]) {
      const m = typeof w === "string" && /^(\d{4}):(\d{2}):(\d{2})/.exec(w);
      if (m && m[1] !== "0000") return `${m[1]}-${m[2]}-${m[3]}`;
    }
  } catch {
    return null;
  }
  return null;
}
