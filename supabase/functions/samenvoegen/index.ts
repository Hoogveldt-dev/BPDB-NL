// Voegt een anonieme speler samen met het account waarmee de speler net inlogde.
// Wie op een toestel anoniem bijdroeg en daarna inlogt met een account dat hij al had, neemt zijn bijdragen mee
// (private.voeg_samen). Daarna verwijderen we de anonieme speler.
//
// Bewijs dat de speler beide accounts bezit: de sessie van het account (Authorization) en het toegangstoken van de
// anonieme speler, dat de app bewaarde vlak voor het inloggen. Nooit een id uit het verzoek.
//
// POST /functions/v1/samenvoegen
// Authorization: Bearer <sessie van het account>
// { "anoniem_token": "<toegangstoken van de anonieme speler>" }

import { createClient } from "npm:@supabase/supabase-js@2.49.4";

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
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return antwoord({ fout: "Alleen POST" }, 405);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceKey) return antwoord({ fout: "De functie mist haar instellingen" }, 500);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const body = await req.json().catch(() => ({}));
  const anoniemToken = typeof body?.anoniem_token === "string" ? body.anoniem_token : "";
  if (!jwt || !anoniemToken) return antwoord({ fout: "Samenvoegen lukte niet: gegevens ontbreken" }, 400);

  const [{ data: naar }, { data: van }] = await Promise.all([admin.auth.getUser(jwt), admin.auth.getUser(anoniemToken)]);
  if (!naar?.user || naar.user.is_anonymous) return antwoord({ fout: "Log eerst in met je account" }, 401);
  // Verlopen (meer dan een uur tussen bewaren en inloggen) of al verwijderd: niets te doen
  if (!van?.user) return antwoord({ fout: "Je bijdragen zonder account konden niet meer worden overgezet" }, 410);
  if (!van.user.is_anonymous || van.user.id === naar.user.id) return antwoord({ ok: true, samengevoegd: false });

  const { data, error } = await admin.rpc("voeg_samen", { p_van: van.user.id, p_naar: naar.user.id });
  // De spelregel (zelf beoordeeld) geeft een Nederlandse melding; die geven we door
  if (error) return antwoord({ fout: error.code === "P0001" ? error.message : "Samenvoegen lukte niet. Probeer het later opnieuw." }, 409);

  await admin.auth.admin.deleteUser(van.user.id);
  return antwoord({ ok: true, samengevoegd: true, ...data });
});
