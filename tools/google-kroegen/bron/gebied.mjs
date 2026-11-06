// Gemeentegrens van het CBS via PDOK, dezelfde bron als de wijken in
// supabase/functions/osm-import.

const PDOK = "https://service.pdok.nl/cbs/wijkenbuurten/2023/wfs/v1_0";

export async function gemeentegrens(gemeentecode) {
  if (!/^GM\d{4}$/.test(gemeentecode)) throw new Error(`Ongeldige gemeentecode: ${gemeentecode}`);
  const url = new URL(PDOK);
  url.search = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: "wijkenbuurten:gemeenten",
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    filter: `<Filter><PropertyIsEqualTo><PropertyName>gemeentecode</PropertyName><Literal>${gemeentecode}</Literal></PropertyIsEqualTo></Filter>`,
  }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`PDOK gaf ${res.status}`);
  const geo = await res.json();
  const land = (geo.features ?? []).filter((f) => f.properties?.water !== "JA");
  if (!land.length) throw new Error(`Gemeente ${gemeentecode} niet gevonden bij PDOK`);
  return { naam: land[0].properties.gemeentenaam, geometrie: land[0].geometry };
}
