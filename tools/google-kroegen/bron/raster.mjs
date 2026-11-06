// Raster over een gebied, zodat we niet aan de limiet per zoekopdracht vastzitten.
// Celberekening overgenomen van grid.GenerateCells in gosom/google-maps-scraper
// (MIT, (c) 2023 Georgios Komninos). Toegevoegd: alleen cellen die de
// gemeentegrens raken, en een zoomniveau dat past bij de celgrootte.

const KM_PER_GRAAD_LAT = 111.32;

export function bboxVan(geometrie) {
  let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
  for (const ring of ringen(geometrie)) {
    for (const [lon, lat] of ring) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
  }
  return { minLat, minLon, maxLat, maxLon };
}

function* ringen(geometrie) {
  if (!geometrie) return;
  if (geometrie.type === "Polygon") yield* geometrie.coordinates;
  else if (geometrie.type === "MultiPolygon") for (const poly of geometrie.coordinates) yield* poly;
}

function inRing(lat, lon, ring) {
  let binnen = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) binnen = !binnen;
  }
  return binnen;
}

/** Ligt het punt binnen de (Multi)Polygon? Gaten (binnenringen) tellen mee. */
export function binnenGebied(lat, lon, geometrie) {
  if (!geometrie) return true;
  const polys = geometrie.type === "Polygon" ? [geometrie.coordinates] : geometrie.coordinates;
  for (const [buiten, ...gaten] of polys) {
    if (inRing(lat, lon, buiten) && !gaten.some((g) => inRing(lat, lon, g))) return true;
  }
  return false;
}

export function maakCellen(bbox, celKm, geometrie = null) {
  const km = Math.min(Math.max(celKm, 0.2), 20);
  const latStap = km / KM_PER_GRAAD_LAT;
  const midLat = (bbox.minLat + bbox.maxLat) / 2;
  const lonStap = km / (KM_PER_GRAAD_LAT * Math.max(Math.cos((midLat * Math.PI) / 180), 1e-6));
  // gosom begint op min + stap/2 en stopt bij max, waardoor een strook langs de
  // noord- en oostrand onbedekt blijft. Hier rekenen we het aantal cellen af naar boven.
  const rijen = Math.max(1, Math.ceil((bbox.maxLat - bbox.minLat) / latStap - 1e-9));
  const kolommen = Math.max(1, Math.ceil((bbox.maxLon - bbox.minLon) / lonStap - 1e-9));
  const cellen = [];
  for (let r = 0; r < rijen; r++) {
    const lat = bbox.minLat + (r + 0.5) * latStap;
    for (let k = 0; k < kolommen; k++) {
      const lon = bbox.minLon + (k + 0.5) * lonStap;
      if (geometrie) {
        const hoeken = [
          [lat, lon],
          [lat - latStap / 2, lon - lonStap / 2],
          [lat - latStap / 2, lon + lonStap / 2],
          [lat + latStap / 2, lon - lonStap / 2],
          [lat + latStap / 2, lon + lonStap / 2],
        ];
        if (!hoeken.some(([a, o]) => binnenGebied(a, o, geometrie))) continue;
      }
      cellen.push({ lat: rond(lat), lon: rond(lon) });
    }
  }
  return cellen;
}

/** Zoomniveau waarbij een kaart van `breedtePx` ongeveer `celKm` breed is. */
export function zoomVoorCel(celKm, lat, breedtePx = 600) {
  const meterPerPx = (celKm * 1000) / breedtePx;
  const zoom = Math.log2((156543.03 * Math.cos((lat * Math.PI) / 180)) / meterPerPx);
  return Math.min(Math.max(Math.round(zoom * 10) / 10, 11), 18);
}

export function afstandM(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function rond(x) {
  return Math.round(x * 1e5) / 1e5;
}
