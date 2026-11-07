// Verwijdert het account van de ingelogde speler.
// Geschiedenis blijft: door_id wordt null via de foreign key, de prijs blijft staan.
//
// POST /functions/v1/account-verwijderen
// Authorization: Bearer <sessie van de speler>

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
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !anonKey || !serviceKey) return antwoord({ fout: "Sleutels ontbreken in de functie-omgeving" }, 500);

  const gebruiker = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: auth, error: authFout } = await gebruiker.auth.getUser();
  if (authFout || !auth.user) return antwoord({ fout: "Niet ingelogd" }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error } = await admin.auth.admin.deleteUser(auth.user.id);
  if (error) return antwoord({ fout: "Verwijderen mislukt" }, 500);
  return antwoord({ ok: true });
});
