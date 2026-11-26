// Bewaart kroegen en wijken van een gemeente uit public.gemeenten. Alleen voor beheerders
// (profielen.is_beheerder = true).
//
// De app haalt de gegevens zelf bij OpenStreetMap (app/overpass.js) en stuurt het antwoord van Overpass mee: vanuit
// Supabase is Overpass niet betrouwbaar bereikbaar. Deze functie verwerkt het (verwerk.ts) en bewaart het.
// Met een horecaregister van de gemeente (HORECAREGISTER) tellen ook cafés en restaurants met een
// vergunning als café of nachtzaak.
// Wijken: een eigen wijkindeling van de gemeente als die er is (LOKALE_WIJKEN, zoals de stadswijken van Gent),
// anders in Nederland van het CBS (PDOK) en in België de deelgemeenten uit het antwoord van Overpass.
//
// Aanroep (met de sessie van een ingelogde beheerder):
//   POST /functions/v1/osm-import
//   { "gemeentecode": "BE44021", "elementen": [ ...elements uit het antwoord van Overpass... ] }

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { HORECAREGISTER, LOKALE_WIJKEN, lokaleWijken, verwerk, vergunningen, type Vergunning } from "./verwerk.ts";

const USER_AGENT = "Bierkoers kroegimport (https://bierkoers.nl)";
const PDOK_WIJKEN = "https://service.pdok.nl/cbs/wijkenbuurten/2023/wfs/v1_0";

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
  const elementen = invoer.elementen;
  if (!Array.isArray(elementen) || elementen.length > 100_000) return antwoord({ fout: "Geen gegevens van OpenStreetMap" }, 400);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: g } = await admin.from("gemeenten").select("code,naam,land")
    .eq("code", String(invoer.gemeentecode ?? "").trim().toUpperCase()).maybeSingle();
  if (!g) return antwoord({ fout: "Deze gemeente staat niet in de gemeentelijst" }, 404);
  const gemeente: string = g.naam;

  // 3. Verwerken: kroegen (in België met de cafés die op een kroeg lijken) en de Belgische deelgemeenten
  // Met een horecaregister (HORECAREGISTER) tellen ook cafés en restaurants met een vergunning als café
  let register: Vergunning[] | undefined;
  if (HORECAREGISTER[g.code]) {
    const rijen: any[] = [];
    for (let u: string | undefined = HORECAREGISTER[g.code]; u;) {
      const res = await fetch(u, { headers: { "User-Agent": USER_AGENT, "Accept-Crs": "EPSG:4326" } });
      if (!res.ok) return antwoord({ fout: `Het horecaregister van ${gemeente} gaf ${res.status}` }, 502);
      const d = await res.json();
      rijen.push(...(Object.values(d._embedded ?? {})[0] as any[] ?? []));
      u = d._links?.next?.href;
    }
    register = vergunningen(rijen);
  }
  const v = verwerk(elementen, gemeente, g.land === "BE", register);
  if (!v.gevonden) return antwoord({ fout: `${gemeente} niet gevonden in OpenStreetMap` }, 400);
  // Zonder kroegen zou importeer_kroegen alle kroegen van de gemeente sluiten: dan is het antwoord onvolledig
  if (!v.kroegen.length) return antwoord({ fout: `Geen kroegen in het antwoord voor ${gemeente}; er is niets gewijzigd` }, 400);

  // 4. Wijken: de eigen indeling van de gemeente, anders in België de deelgemeenten en in Nederland het CBS (PDOK)
  let wijkGeo = v.wijken;
  if (LOKALE_WIJKEN[g.code]) {
    const res = await fetch(LOKALE_WIJKEN[g.code].url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return antwoord({ fout: `De wijken van ${gemeente} gaven ${res.status}` }, 502);
    wijkGeo = lokaleWijken(await res.json(), g.code, gemeente);
    if (!wijkGeo.features.length) return antwoord({ fout: `Geen wijken gevonden voor ${gemeente}` }, 502);
  } else if (!wijkGeo) {
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
    const cbs = await wijkRes.json();
    // Water-wijken (bijv. de Waal) overslaan; de naam van de gemeente zoals in de app (Den Haag, niet 's-Gravenhage)
    cbs.features = (cbs.features ?? []).filter((f: any) => f.properties?.water !== "JA");
    for (const f of cbs.features) f.properties.gemeentenaam = gemeente;
    wijkGeo = cbs;
  }
  const { data: wijken, error: wijkFout } = await admin.rpc("importeer_wijken", { p_geojson: wijkGeo });
  if (wijkFout) return antwoord({ fout: wijkFout.message }, 500);

  // 5. Kroegen opslaan
  const { data: aantal, error: kroegFout } = await admin.rpc("importeer_kroegen", {
    p_kroegen: v.kroegen,
    p_gemeente: gemeente,
  });
  if (kroegFout) return antwoord({ fout: kroegFout.message }, 500);

  return antwoord({ gemeente, gemeentecode: g.code, wijken, kroegen: aantal, cafes: v.cafes, uitRegister: v.uitRegister });
}
