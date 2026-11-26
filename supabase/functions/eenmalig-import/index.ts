// Eenmalige kroegimport vanuit een cloudsessie (zie supabase/README.md, Kroegen importeren vanuit een sessie).
// Wordt niet als gewone functie uitgerold: de sessie rolt een kort bestand uit dat start() aanroept met de
// SHA-256 van een willekeurige sleutel, en daarna direct een lege versie die 410 geeft.
// Maakt een sessie voor een beheerder en stuurt { gemeentecode, elementen } door naar osm-import.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const hex = async (t: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, "0")).join("");

export function start(sleutelHash: string) {
  Deno.serve(async (req) => {
    if (await hex(req.headers.get("x-eenmalig") ?? "") !== sleutelHash) return new Response("nee", { status: 403 });
    const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: p } = await admin.from("profielen").select("id").eq("is_beheerder", true).limit(1).single();
    const { data: u } = await admin.auth.admin.getUserById(p!.id);
    const { data: l, error: le } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user!.email! });
    if (le) return new Response("link: " + le.message, { status: 500 });
    const sessie = createClient(url, anon, { auth: { persistSession: false } });
    const { data: s, error: se } = await sessie.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: "magiclink" });
    if (se) return new Response("otp: " + se.message, { status: 500 });
    const r = await fetch(url + "/functions/v1/osm-import", {
      method: "POST", body: await req.text(),
      headers: { "Content-Type": "application/json", apikey: anon, Authorization: "Bearer " + s.session!.access_token },
    });
    await sessie.auth.signOut();
    return new Response(await r.text(), { status: r.status, headers: { "Content-Type": "application/json" } });
  });
}
