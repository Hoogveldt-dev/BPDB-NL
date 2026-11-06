// Bouwt een zoekantwoord in het formaat van /search?tbm=map, met alleen de
// indexen die bron/ontleed.mjs leest. Zo documenteert de test ook de paden.

function zet(arr, pad, waarde) {
  let a = arr;
  for (const i of pad.slice(0, -1)) {
    if (!Array.isArray(a[i])) a[i] = [];
    a = a[i];
  }
  a[pad.at(-1)] = waarde;
}

export function zaak({
  naam = "Café Test🍺",
  placeId = "ChIJtest",
  dataId = "0x47c708440a972acb:0x46d64948ed90fea2",
  categorieen = ["Café"],
  adres = ["Grote Markt 1", "6511 KA Nijmegen", "Nederland"],
  lat = 51.8478,
  lon = 5.8634,
  beoordeling = 4.5,
  reviews = 120,
  telefoon = "+31 24 123 4567",
  website = "https://example.nl/",
  uren = [["maandag", 1, [2026, 11, 9], [["11:00–02:00", [[11], [2]]]], 0, 1]],
  oudeUren = null,
  status = null,
} = {}) {
  const z = [];
  zet(z, [2], adres);
  zet(z, [4, 2], "€€");
  zet(z, [4, 7], beoordeling);
  zet(z, [4, 8], reviews);
  zet(z, [7, 0], website);
  zet(z, [9, 2], lat);
  zet(z, [9, 3], lon);
  zet(z, [10], dataId);
  zet(z, [11], naam);
  zet(z, [13], categorieen);
  zet(z, [78], placeId);
  zet(z, [88, 0], status ?? "Honden toegestaan");
  if (telefoon) zet(z, [178, 0, 0], telefoon);
  if (uren) zet(z, [203, 0], uren);
  if (oudeUren) zet(z, [34, 1], oudeUren);
  return z;
}

export function antwoord(zaken, zoekterm = "kroeg") {
  const items = [[null, null, null, null, null, null, null, null, "meta"]];
  for (const z of zaken) {
    const item = [];
    item[14] = z;
    items.push(item);
  }
  return ")]}'\n" + JSON.stringify([[zoekterm, items]]);
}
