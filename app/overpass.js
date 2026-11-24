// Kroegen en grenzen van een gemeente ophalen bij OpenStreetMap (Overpass), vanuit de browser van de beheerder.
// Vanuit Supabase lukt dat niet betrouwbaar: overpass-api.de weigert de servers van Supabase (406) en de andere
// servers geven daar vaak een time-out. Vanuit een gewone browser werkt overpass-api.de wel; mail.ru en kumi.systems
// zijn de reserves. De Edge Function osm-import verwerkt en bewaart het antwoord.
export const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

// De query voor een gemeente uit de tabel gemeenten. De gemeente wordt op code gezocht (ref:gemeentecode in
// Nederland, ref:INS in België), niet op naam. In België ook amenity=cafe, want daar betekent café kroeg (de
// functie houdt alleen de cafés die op een kroeg lijken), en de deelgemeenten met hun grenzen als wijken.
export function osmQuery(g) {
  const belgie = g.code.startsWith("BE");
  const ref = belgie ? `["ref:INS"="${g.code.slice(2)}"]` : `["ref:gemeentecode"="${g.code.slice(2)}"]`;
  const soorten = belgie ? "pub|bar|biergarten|cafe" : "pub|bar|biergarten";
  return `[out:json][timeout:90];
rel["boundary"="administrative"]["admin_level"="8"]${ref}->.r;
.r out ids;
.r map_to_area->.g;
nwr["amenity"~"^(${soorten})$"](area.g);
out center tags;${belgie ? `
rel(r.r:"subarea")["boundary"="administrative"];
out geom;` : ""}`;
}

// Probeert de servers op volgorde, twee rondes. Overpass geeft bij een time-out soms 200 met een "remark" en een
// onvolledig antwoord; dat telt als mislukt. Vindt een server de gemeente niet, dan heeft opnieuw proberen geen zin.
export async function haalOsm(g, { haal = fetch, pauze = 3000, maxDuur = 75_000 } = {}) {
  const query = osmQuery(g);
  const fouten = [];
  for (let ronde = 0; ronde < 2; ronde++) {
    if (ronde) await new Promise((klaar) => setTimeout(klaar, pauze));
    for (const server of OVERPASS) {
      const host = new URL(server).host;
      let antwoord;
      try {
        const res = await haal(server, { method: "POST", body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(maxDuur) });
        if (!res.ok) { fouten.push(`${host} ${res.status}`); continue; }
        antwoord = await res.json();
      } catch (e) {
        fouten.push(`${host} ${e?.name === "TimeoutError" ? "time-out" : "geen verbinding"}`);
        continue;
      }
      if (/error/i.test(antwoord?.remark ?? "") || !Array.isArray(antwoord?.elements)) { fouten.push(`${host} onvolledig`); continue; }
      if (!antwoord.elements.some((e) => e.type === "relation" && !e.tags)) throw new Error(`${g.naam} niet gevonden in OpenStreetMap`);
      return antwoord.elements;
    }
  }
  throw new Error(`OpenStreetMap niet bereikbaar (${fouten.join(", ")}). Probeer het over een paar minuten opnieuw.`);
}
