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

export type Verwerkt = {
  gevonden: boolean;
  kroegen: { osm_id: string; naam: string; soort: string; adres: string | null; lat: number; lon: number }[];
  cafes: number;
  wijken: { type: string; features: unknown[] } | null;
};

// elementen: het antwoord van de query die de app stuurt (gemeente-relatie zonder tags, kroegen met tags en
// center, in België ook de deelgemeenten met geometrie)
export function verwerk(elementen: OsmElement[], gemeente: string, belgie: boolean): Verwerkt {
  const gevonden = elementen.some((e) => e.type === "relation" && !e.tags);
  const kroegen = elementen
    .filter((e) => SOORTEN.has(e.tags?.amenity ?? "") && e.tags!.name)
    .filter((e) => e.tags!.amenity !== "cafe" || cafeIsKroeg(e.tags!))
    .map((e) => {
      const t = e.tags!;
      const straat = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ");
      return { osm_id: `${e.type}/${e.id}`, naam: t.name, soort: t.amenity, adres: straat || null,
        lat: (e.lat ?? e.center?.lat)!, lon: (e.lon ?? e.center?.lon)! };
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
  return { gevonden, kroegen, cafes: kroegen.filter((k) => k.soort === "cafe").length, wijken };
}
