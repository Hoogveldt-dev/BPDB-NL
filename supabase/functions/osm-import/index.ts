// Importeert kroegen uit OpenStreetMap (Overpass) en wijken voor een gemeente uit public.gemeenten.
// Nederland: wijken van het CBS (PDOK). België: de deelgemeenten uit OpenStreetMap (de subareas van de gemeente).
// Alleen voor beheerders (profielen.is_beheerder = true).
//
// Aanroep (met de sessie van een ingelogde beheerder):
//   POST /functions/v1/osm-import
//   { "gemeentecode": "BE44021", "soorten": ["pub", "bar", "biergarten"] }
// In plaats van de code mag ook de naam ({ "gemeente": "Nijmegen" }); de functie zoekt hem op in public.gemeenten.
// De gemeente wordt in OpenStreetMap gezocht op code (ref:gemeentecode of ref:INS), niet op naam, zodat ook
// "Bergen (NH)" en "Den Haag" (officieel 's-Gravenhage) de goede gemeente vinden.

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { multipolygoon, type OsmElement } from "./grenzen.ts";

// Overpass weigert of overbelast soms; probeer dan de volgende server. overpass-api.de weigerde in november 2026
// verzoeken vanuit Supabase (406), dus de server van mail.ru staat voorop. Elke poging duurt hoogstens een minuut.
const OVERPASS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const USER_AGENT = "BPDB-NL kroegimport (https://bpdb-nl.pages.dev)";
const PDOK_WIJKEN = "https://service.pdok.nl/cbs/wijkenbuurten/2023/wfs/v1_0";
const TOEGESTANE_SOORTEN = ["pub", "bar", "biergarten", "cafe", "nightclub"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function antwoord(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function overpass(query: string): Promise<{ elements: OsmElement[] }> {
  const fouten: string[] = [];
  for (const server of OVERPASS) {
    try {
      const res = await fetch(server, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
          "User-Agent": USER_AGENT,
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(60_000),
      });
      const tekst = await res.text();
      if (!res.ok) {
        fouten.push(`${new URL(server).host} gaf ${res.status}`);
        console.error("Overpass", server, res.status, tekst.slice(0, 300));
        continue;
      }
      return JSON.parse(tekst);
    } catch (e) {
      fouten.push(`${new URL(server).host}: ${(e as Error).message}`);
      console.error("Overpass", server, e);
    }
  }
  throw new Error(`OpenStreetMap niet bereikbaar (${fouten.join("; ")})`);
}

Deno.serve(async (req) => {
  try {
    return await importeer(req);
  } catch (e) {
    console.error(e);
    return antwoord({ fout: (e as Error).message ?? "Onbekende fout" }, 502);
  }
});

async function importeer(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return antwoord({ fout: "Alleen POST" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!url || !anonKey || !serviceKey) return antwoord({ fout: "Sleutels ontbreken in de functie-omgeving" }, 500);

  // 1. Is de aanroeper een beheerder?
  const gebruiker = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: auth, error: authFout } = await gebruiker.auth.getUser();
  if (authFout || !auth.user) return antwoord({ fout: "Niet ingelogd" }, 401);
  const { data: profiel } = await gebruiker
    .from("profielen").select("is_beheerder").eq("id", auth.user.id).single();
  if (!profiel?.is_beheerder) return antwoord({ fout: "Alleen voor beheerders" }, 403);

  // 2. Invoer controleren: de gemeente moet in public.gemeenten staan
  const invoer = await req.json().catch(() => ({}));
  const soorten: string[] = (Array.isArray(invoer.soorten) ? invoer.soorten : ["pub", "bar", "biergarten"])
    .filter((s: unknown) => TOEGESTANE_SOORTEN.includes(String(s)));
  if (soorten.length === 0) return antwoord({ fout: "Geen geldige soorten" }, 400);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const zoek = admin.from("gemeenten").select("code,naam,land");
  const { data: g } = invoer.gemeentecode
    ? await zoek.eq("code", String(invoer.gemeentecode).trim().toUpperCase()).maybeSingle()
    : await zoek.ilike("naam", String(invoer.gemeente ?? "Nijmegen").trim().replace(/[%_\\]/g, "")).maybeSingle();
  if (!g) return antwoord({ fout: "Deze gemeente staat niet in de gemeentelijst" }, 404);
  const gemeente: string = g.naam;
  const belgie = g.land === "BE";
  const ref = belgie ? `["ref:INS"="${g.code.slice(2)}"]` : `["ref:gemeentecode"="${g.code.slice(2)}"]`;

  // 3. Kroegen en, in België, de deelgemeenten (OpenStreetMap via Overpass)
  const regex = `^(${soorten.join("|")})$`;
  const query = `[out:json][timeout:90];
rel["boundary"="administrative"]["admin_level"="8"]${ref}->.r;
.r out ids;
.r map_to_area->.g;
nwr["amenity"~"${regex}"](area.g);
out center tags;
${belgie ? `rel(r.r:"subarea")["boundary"="administrative"];\nout geom;` : ""}`;
  const osm = await overpass(query);
  const relatie = osm.elements.find((e) => e.type === "relation" && !e.tags);
  if (!relatie) return antwoord({ fout: `${gemeente} niet gevonden in OpenStreetMap` }, 404);

  // 4. Wijken
  let wijkGeo: { type: string; features: unknown[] };
  if (belgie) {
    wijkGeo = {
      type: "FeatureCollection",
      features: osm.elements
        .filter((e) => e.type === "relation" && e.tags?.boundary === "administrative" && e.tags?.name)
        .map((e) => ({
          type: "Feature",
          properties: { wijkcode: `OSM-R${e.id}`, wijknaam: e.tags!.name, gemeentenaam: gemeente },
          geometry: multipolygoon(e),
        }))
        .filter((f) => f.geometry),
    };
  } else {
    // CBS via PDOK
    const filter =
      `<Filter><PropertyIsEqualTo><PropertyName>gemeentecode</PropertyName><Literal>${g.code}</Literal></PropertyIsEqualTo></Filter>`;
    const wfs = new URL(PDOK_WIJKEN);
    wfs.search = new URLSearchParams({
      service: "WFS",
      version: "2.0.0",
      request: "GetFeature",
      typeNames: "wijkenbuurten:wijken",
      outputFormat: "application/json",
      srsName: "EPSG:4326",
      filter,
    }).toString();
    const wijkRes = await fetch(wfs, { headers: { "User-Agent": USER_AGENT } });
    if (!wijkRes.ok) {
      console.error("PDOK", wijkRes.status, (await wijkRes.text()).slice(0, 300));
      return antwoord({ fout: `CBS-wijken (PDOK) gaf ${wijkRes.status}` }, 502);
    }
    wijkGeo = await wijkRes.json();
    // Water-wijken (bijv. de Waal) overslaan.
    wijkGeo.features = (wijkGeo.features ?? []).filter((f: any) => f.properties?.water !== "JA");
    // De naam van de gemeente zoals in de app (Den Haag in plaats van 's-Gravenhage)
    for (const f of wijkGeo.features as any[]) f.properties.gemeentenaam = gemeente;
  }
  const { data: wijken, error: wijkFout } = await admin.rpc("importeer_wijken", { p_geojson: wijkGeo });
  if (wijkFout) return antwoord({ fout: wijkFout.message }, 500);

  // 5. Kroegen opslaan
  const kroegen = osm.elements
    .filter((e) => e.tags?.amenity)
    .map((e) => {
      const t = e.tags ?? {};
      const lat = e.lat ?? e.center?.lat;
      const lon = e.lon ?? e.center?.lon;
      const straat = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ");
      return {
        osm_id: `${e.type}/${e.id}`,
        naam: t.name,
        soort: t.amenity,
        adres: straat || null,
        lat,
        lon,
      };
    })
    .filter((k) => k.naam && k.lat != null && k.lon != null);

  const { data: aantal, error: kroegFout } = await admin.rpc("importeer_kroegen", {
    p_kroegen: kroegen,
    p_gemeente: gemeente,
  });
  if (kroegFout) return antwoord({ fout: kroegFout.message }, 500);

  return antwoord({ gemeente, gemeentecode: g.code, wijken, kroegen: aantal });
}
