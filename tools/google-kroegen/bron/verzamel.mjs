// Haalt alle kroegen in een gebied op: elke cel van het raster, elke zoekterm,
// pagina voor pagina tot er niets nieuws meer komt. Ontdubbelt op place_id.

import { zoekPad, PER_PAGINA } from "./zoekurl.mjs";
import { ontleedZoekantwoord, OnverwachtAntwoord } from "./ontleed.mjs";
import { classificeer } from "./classificeer.mjs";
import { Gezondheid } from "./gezondheid.mjs";
import { binnenGebied, zoomVoorCel } from "./raster.mjs";

export const STANDAARD_ZOEKTERMEN = ["kroeg", "café", "bar", "pub"];

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

export function sleutel(p) {
  return p.place_id ?? (p.data_id ? `data:${p.data_id}` : null);
}

export async function verzamel({
  cellen,
  celKm,
  geometrie = null,
  zoektermen = STANDAARD_ZOEKTERMEN,
  transport,
  maxPaginas = 6,
  pauzeMs = 1200,
  clubs = false,
  minZekerheid = "middel",
  gezondheid = new Gezondheid(),
  log = () => {},
}) {
  const gevonden = new Map();
  const genegeerd = new Map();
  let verzoeken = 0;

  for (const [ci, cel] of cellen.entries()) {
    const zoom = zoomVoorCel(celKm, cel.lat);
    for (const zoekterm of zoektermen) {
      for (let pagina = 0; pagina < maxPaginas; pagina++) {
        const pad = zoekPad({ zoekterm, lat: cel.lat, lon: cel.lon, zoom, offset: pagina * PER_PAGINA });
        if (verzoeken++ > 0) await wacht(pauzeMs * (0.75 + Math.random() * 0.5));

        let plaatsen;
        try {
          plaatsen = ontleedZoekantwoord(await transport.haal(pad));
          gezondheid.antwoord(true);
        } catch (e) {
          if (!(e instanceof OnverwachtAntwoord)) throw e;
          gezondheid.antwoord(false);
          gezondheid.controleer();
          log(`  cel ${ci + 1} "${zoekterm}" p${pagina + 1}: ${e.message}`);
          break;
        }

        let nieuw = 0; // nieuwe kroegen
        let onbekend = 0; // nieuwe plaatsen in het gebied, kroeg of niet
        for (const p of plaatsen) {
          gezondheid.plaats(p);
          const k = sleutel(p);
          if (!k || p.lat == null || p.lon == null) continue;
          if (!binnenGebied(p.lat, p.lon, geometrie)) continue;
          if (gevonden.has(k)) {
            gevonden.get(k).gevonden_via.add(zoekterm);
            continue;
          }
          if (genegeerd.has(k)) continue;
          onbekend++;
          const { soort, zekerheid } = classificeer(p.categorieen, { clubs });
          if (!soort || (minZekerheid === "hoog" && zekerheid !== "hoog")) {
            genegeerd.set(k, p);
            continue;
          }
          gevonden.set(k, { ...p, soort, zekerheid, gevonden_via: new Set([zoekterm]) });
          nieuw++;
        }
        gezondheid.controleer();
        log(`  cel ${ci + 1}/${cellen.length} "${zoekterm}" p${pagina + 1}: ${plaatsen.length} resultaten, ${nieuw} nieuw (totaal ${gevonden.size})`);
        if (plaatsen.length < PER_PAGINA) break; // laatste pagina
        if (onbekend === 0 && pagina > 0) break; // niets nieuws meer in dit gebied
      }
    }
  }

  const kroegen = [...gevonden.values()]
    .map((k) => ({ ...k, gevonden_via: [...k.gevonden_via].sort() }))
    .sort((a, b) => a.naam.localeCompare(b.naam, "nl"));
  return { kroegen, genegeerd: genegeerd.size, verzoeken, gezondheid };
}
