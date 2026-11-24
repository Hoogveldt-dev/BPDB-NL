// Grenzen van OpenStreetMap omzetten naar GeoJSON (los bestand, zodat de test het zonder Deno kan laden).

type Punt = { lat: number; lon: number };
export type OsmElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: Punt;
  tags?: Record<string, string>;
  members?: { type: string; role: string; geometry?: Punt[] }[];
};

// Een grensrelatie uit Overpass (out geom) als GeoJSON-MultiPolygon: de wegen per rol aan elkaar rijgen tot
// gesloten ringen, en elke binnenring bij de buitenring waar hij in ligt.
export function multipolygoon(e: OsmElement) {
  const ringen = (rol: string) => rijg(
    (e.members ?? []).filter((m) => m.type === "way" && m.role === rol && m.geometry?.length)
      .map((m) => m.geometry!.map((p) => [p.lon, p.lat])),
  );
  const buiten = ringen("outer");
  if (!buiten.length) return null;
  const polygonen = buiten.map((r) => [r]);
  for (const binnen of ringen("inner")) {
    const p = polygonen.find((pol) => inRing(binnen[0], pol[0]));
    if (p) p.push(binnen);
  }
  return { type: "MultiPolygon", coordinates: polygonen };
}

const zelfde = (a: number[], b: number[]) => a[0] === b[0] && a[1] === b[1];

function rijg(wegen: number[][][]): number[][][] {
  const ringen: number[][][] = [];
  const over = [...wegen];
  while (over.length) {
    const ring = [...over.shift()!];
    while (!zelfde(ring[0], ring[ring.length - 1])) {
      const eind = ring[ring.length - 1];
      const i = over.findIndex((w) => zelfde(w[0], eind) || zelfde(w[w.length - 1], eind));
      if (i < 0) break; // open ring: onvolledige grens in OSM, overslaan
      const w = over.splice(i, 1)[0];
      ring.push(...(zelfde(w[0], eind) ? w : [...w].reverse()).slice(1));
    }
    if (ring.length >= 4 && zelfde(ring[0], ring[ring.length - 1])) ringen.push(ring);
  }
  return ringen;
}

function inRing([x, y]: number[], ring: number[][]) {
  let binnen = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) binnen = !binnen;
  }
  return binnen;
}
