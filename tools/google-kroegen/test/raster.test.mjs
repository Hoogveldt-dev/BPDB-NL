import { test } from "node:test";
import assert from "node:assert/strict";
import { maakCellen, binnenGebied, bboxVan, zoomVoorCel, afstandM } from "../bron/raster.mjs";
import { zoekPad } from "../bron/zoekurl.mjs";

const vierkant = (a, b, c, d) => [[b, a], [d, a], [d, c], [b, c], [b, a]];
const metGat = { type: "Polygon", coordinates: [vierkant(51.8, 5.8, 51.9, 5.9), vierkant(51.84, 5.84, 51.86, 5.86)] };

test("binnen gebied, met gat", () => {
  assert.equal(binnenGebied(51.82, 5.82, metGat), true);
  assert.equal(binnenGebied(51.85, 5.85, metGat), false);
  assert.equal(binnenGebied(52.5, 5.85, metGat), false);
  assert.equal(binnenGebied(52.5, 5.85, null), true);
});

test("cellen bedekken het gebied en volgen de grens", () => {
  const bbox = bboxVan(metGat);
  assert.deepEqual(bbox, { minLat: 51.8, minLon: 5.8, maxLat: 51.9, maxLon: 5.9 });
  const cellen = maakCellen(bbox, 1.5);
  assert.equal(cellen.length, 40); // 8 rijen (11,1 km) bij 5 kolommen (6,9 km)
  const noordoost = cellen.reduce((a, c) => (c.lat >= a.lat && c.lon >= a.lon ? c : a));
  assert.ok(afstandM(noordoost.lat, noordoost.lon, 51.9, 5.9) < 1500, "noordoosthoek bedekt");
  const driehoek = { type: "Polygon", coordinates: [[[5.8, 51.8], [5.9, 51.8], [5.8, 51.9], [5.8, 51.8]]] };
  assert.ok(maakCellen(bbox, 1.5, driehoek).length < cellen.length);
});

test("zoom past bij celgrootte en afstand klopt", () => {
  assert.equal(zoomVoorCel(1.5, 51.85), 15.2);
  assert.ok(zoomVoorCel(5, 51.85) < zoomVoorCel(1, 51.85));
  assert.ok(Math.abs(afstandM(51.8, 5.8, 51.9, 5.8) - 11119) < 5);
});

test("zoekpad bevat locatie, zoom en offset", () => {
  const p = decodeURIComponent(zoekPad({ zoekterm: "kroeg", lat: 51.845, lon: 5.864, zoom: 15, offset: 40 }));
  assert.match(p, /^\/search\?tbm=map/);
  assert.match(p, /!2d5\.8640!3d51\.8450/);
  assert.match(p, /!4f15\.0!7i20!8i40/);
  assert.match(p, /hl=nl&gl=nl&q=kroeg/);
});
