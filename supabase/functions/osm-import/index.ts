// Importeert kroegen uit OpenStreetMap (Overpass) en wijken van het CBS (PDOK)
// voor een gemeente. Alleen voor beheerders (profielen.is_beheerder = true).
//
// Aanroep (met de sessie van een ingelogde beheerder):
//   POST /functions/v1/osm-import
//   { "gemeente": "Nijmegen", "gemeentecode": "GM0268", "soorten": ["pub", "bar", "biergarten"] }

import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const OVERPASS = "https://overpass-api.de/api/interpreter";
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

type OsmElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

Deno.serve(async (req) => {
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

  // 2. Invoer controleren
  const invoer = await req.json().catch(() => ({}));
  const gemeente = String(invoer.gemeente ?? "Nijmegen").trim();
  const gemeentecode = String(invoer.gemeentecode ?? "GM0268").trim().toUpperCase();
  const soorten: string[] = (Array.isArray(invoer.soorten) ? invoer.soorten : ["pub", "bar", "biergarten"])
    .filter((s: unknown) => TOEGESTANE_SOORTEN.includes(String(s)));
  if (!/^[\p{L} .'-]{2,60}$/u.test(gemeente)) return antwoord({ fout: "Ongeldige gemeente" }, 400);
  if (!/^GM\d{4}$/.test(gemeentecode)) return antwoord({ fout: "Ongeldige gemeentecode" }, 400);
  if (soorten.length === 0) return antwoord({ fout: "Geen geldige soorten" }, 400);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // 3. Wijken (CBS via PDOK)
  const filter =
    `<Filter><PropertyIsEqualTo><PropertyName>gemeentecode</PropertyName><Literal>${gemeentecode}</Literal></PropertyIsEqualTo></Filter>`;
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
  const wijkRes = await fetch(wfs);
  if (!wijkRes.ok) return antwoord({ fout: `PDOK gaf ${wijkRes.status}` }, 502);
  const wijkGeo = await wijkRes.json();
  // Water-wijken (bijv. de Waal) overslaan.
  wijkGeo.features = (wijkGeo.features ?? []).filter((f: any) => f.properties?.water !== "JA");
  const { data: wijken, error: wijkFout } = await admin.rpc("importeer_wijken", { p_geojson: wijkGeo });
  if (wijkFout) return antwoord({ fout: wijkFout.message }, 500);

  // 4. Kroegen (OpenStreetMap via Overpass)
  const regex = `^(${soorten.join("|")})$`;
  const query = `[out:json][timeout:60];
area["boundary"="administrative"]["admin_level"="8"]["name"="${gemeente.replace(/"/g, "")}"]->.g;
nwr["amenity"~"${regex}"](area.g);
out center tags;`;
  const osmRes = await fetch(OVERPASS, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "BPDB-NL kroegimport" },
    body: new URLSearchParams({ data: query }),
  });
  if (!osmRes.ok) return antwoord({ fout: `Overpass gaf ${osmRes.status}` }, 502);
  const osm = await osmRes.json() as { elements: OsmElement[] };

  const kroegen = osm.elements
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

  return antwoord({ gemeente, wijken, kroegen: aantal });
});
