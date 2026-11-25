// Verwerkt het antwoord van Overpass tot kroegen en wijken (los bestand, zodat de test het zonder Deno kan laden).
import { multipolygoon, type OsmElement } from "./grenzen.ts";

// In België zijn veel echte kroegen in OpenStreetMap als amenity=cafe ingevoerd ("café" betekent er kroeg), maar
// koffiezaken, lunchrooms en ketens als Starbucks ook. Een café telt als kroeg als niets op een koffiezaak wijst en
// (1) hij volgens de openingstijden ergens na 22:00 open is, of (2) zonder openingstijden de naam op een kroeg wijst
// ('t Vosken, Den Turk, Café Folklore, Herberg Macharius, Sportbar Keiskant).
const KOFFIE_NAAM = /coffee|koffie|kaffee|kaffie|espresso|barista|caff[eè]|crema|beans?\b|\btea\b|\bthee\b|bubble|bak(ery|ehouse|kerij)|p[aâ]tisserie|waffle|wafel|gelato|juice|smoothie|brunch|lunch/i;
// Een keuken wijst op een eet- of koffiezaak, behalve een streekkeuken (Het Gouden Hoofd: regional)
const KROEG_KEUKEN = /^(regional|local|belgian|flemish|pub|beer)$/i;
const KROEG_NAAM = /^(['’]?t|den|in ['’]?t|in de)\s|(^|[^\p{L}])(caf[eé]|kaf[eé]|herberg|taverne|tavern|estaminet|bar|pub|kroeg|staminee|clubhouse|clubhuis|sportbar|slijterij|bierhuis|biercaf[eé]|brouwerij)($|[^\p{L}])/iu;

// Is de zaak op een dag open tot 22:00 of later (of tot na middernacht)?
export function laatOpen(uren: string | undefined): boolean | null {
  if (!uren) return null;
  const tijden = [...uren.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)];
  if (!tijden.length) return null;
  return tijden.some(([, sh, sm, eh, em]) => {
    const begin = +sh * 60 + +sm, eind = +eh * 60 + +em;
    return eind >= 22 * 60 || eind < begin || +eh < 6;
  });
}

export function cafeIsKroeg(t: Record<string, string>): boolean {
  const keuken = (t.cuisine ?? "").split(";").filter(Boolean);
  if (t.brand || t.shop || keuken.some((k) => !KROEG_KEUKEN.test(k.trim())) || KOFFIE_NAAM.test(t.name ?? "")) return false;
  const laat = laatOpen(t.opening_hours);
  if (laat !== null) return laat;
  return KROEG_NAAM.test(t.name ?? "");
}

const SOORTEN = new Set(["pub", "bar", "biergarten", "cafe", "nightclub"]);

// Gemeenten met een openbaar register van horecavergunningen. Daar telt een café, restaurant of nachtclub uit
// OpenStreetMap als kroeg als er binnen 40 m een vergunning als café of nachtzaak is met een gelijkende naam
// (in Amsterdam staan veel bruine cafés in OSM als restaurant of café). De query in app/overpass.js haalt voor
// deze gemeenten ook cafés, restaurants en nachtclubs op (REGISTER_GEMEENTEN).
export const HORECAREGISTER: Record<string, string> = {
  // Gemeente Amsterdam: exploitatievergunningen horeca (api.data.amsterdam.nl, CC0)
  GM0363: "https://api.data.amsterdam.nl/v1/horeca/exploitatievergunning/?_format=json&_pageSize=1000&_fields=zaaknaam,zaakCategorie,statusVergunning,locatie",
};
export type Vergunning = { naam: string; lat: number; lon: number };

// Rijen van het register (locatie in WGS84) naar de vergunningen van cafés en nachtzaken
export function vergunningen(rijen: any[]): Vergunning[] {
  return rijen
    .filter((r) => /^(Café|Nachtzaak)$/.test(r.zaakCategorie ?? "") && r.statusVergunning !== "Buiten behandeling" && r.locatie?.coordinates)
    .map((r) => ({ naam: r.zaaknaam ?? "", lon: r.locatie.coordinates[0], lat: r.locatie.coordinates[1] }));
}

const kaal = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/\b(grand|eet)?(cafe|caf|bar|restaurant|b\.?v\.?|de|het|the|t)\b/g, "").replace(/[^a-z0-9]/g, "");

export function inRegister(naam: string, lat: number, lon: number, register: Vergunning[]): boolean {
  const n = kaal(naam);
  if (n.length < 3) return false;
  return register.some((v) => {
    const m = Math.hypot((v.lat - lat) * 111_320, (v.lon - lon) * 111_320 * Math.cos(lat * Math.PI / 180));
    if (m > 40) return false;
    const w = kaal(v.naam);
    return w.length >= 3 && (w.includes(n) || n.includes(w) || w.slice(0, 5) === n.slice(0, 5));
  });
}

export type Verwerkt = {
  gevonden: boolean;
  kroegen: { osm_id: string; naam: string; soort: string; adres: string | null; lat: number; lon: number }[];
  cafes: number;
  uitRegister: number;
  wijken: { type: string; features: unknown[] } | null;
};

// elementen: het antwoord van de query die de app stuurt (gemeente-relatie zonder tags, kroegen met tags en
// center, in België ook de deelgemeenten met geometrie); register: vergunningen als de gemeente een register heeft
export function verwerk(elementen: OsmElement[], gemeente: string, belgie: boolean, register?: Vergunning[]): Verwerkt {
  const gevonden = elementen.some((e) => e.type === "relation" && !e.tags);
  const plek = (e: OsmElement) => ({ lat: (e.lat ?? e.center?.lat)!, lon: (e.lon ?? e.center?.lon)! });
  const viaRegister = (e: OsmElement) => !!register && ["cafe", "restaurant", "nightclub"].includes(e.tags!.amenity) &&
    inRegister(e.tags!.name, plek(e).lat, plek(e).lon, register);
  let uitRegister = 0;
  const kroegen = elementen
    .filter((e) => e.tags?.name && (SOORTEN.has(e.tags.amenity ?? "") || e.tags.amenity === "restaurant"))
    .filter((e) => {
      const a = e.tags!.amenity;
      if (register && ["cafe", "restaurant", "nightclub"].includes(a)) return viaRegister(e) && ++uitRegister > 0;
      return a === "cafe" ? cafeIsKroeg(e.tags!) : a !== "restaurant";
    })
    .map((e) => {
      const t = e.tags!;
      const straat = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ");
      return { osm_id: `${e.type}/${e.id}`, naam: t.name, soort: t.amenity, adres: straat || null,
        ...plek(e) };
    })
    .filter((k) => Number.isFinite(k.lat) && Number.isFinite(k.lon));
  const wijken = belgie
    ? {
      type: "FeatureCollection",
      features: elementen
        .filter((e) => e.type === "relation" && e.tags?.boundary === "administrative" && e.tags?.name)
        .map((e) => ({
          type: "Feature",
          properties: { wijkcode: `OSM-R${e.id}`, wijknaam: e.tags!.name, gemeentenaam: gemeente },
          geometry: multipolygoon(e),
        }))
        .filter((f) => f.geometry),
    }
    : null;
  return { gevonden, kroegen, cafes: belgie ? kroegen.filter((k) => k.soort === "cafe").length : 0, uitRegister, wijken };
}

// Gemeenten met een eigen, officiële wijkindeling: het lokale equivalent van de CBS-wijken. Zonder vermelding hier
// zijn de wijken in België de deelgemeenten uit OpenStreetMap. Een nieuwe stad: een regel met de GeoJSON-bron
// (WGS84) en de velden voor het nummer en de naam van de wijk; de bron staat ook in de bronvermelding van de kaart.
export const LOKALE_WIJKEN: Record<string, { url: string; nr: string; naam: string }> = {
  // Stad Gent: 25 stadswijken (data.stad.gent, Modellicentie Gratis Hergebruik)
  BE44021: { url: "https://data.stad.gent/api/explore/v2.1/catalog/datasets/stadswijken-gent/exports/geojson", nr: "wijknr", naam: "wijk" },
};

// Zet de GeoJSON van een lokale bron om naar de vorm van importeer_wijken (wijkcode, wijknaam, gemeentenaam)
export function lokaleWijken(geo: { features?: any[] }, code: string, gemeente: string) {
  const bron = LOKALE_WIJKEN[code];
  const features = (geo.features ?? [])
    .filter((f) => f.geometry && f.properties?.[bron.naam] && f.properties?.[bron.nr] != null)
    .map((f) => ({
      type: "Feature",
      properties: { wijkcode: `${code}-${f.properties[bron.nr]}`, wijknaam: String(f.properties[bron.naam]), gemeentenaam: gemeente },
      geometry: f.geometry,
    }));
  return { type: "FeatureCollection", features };
}
