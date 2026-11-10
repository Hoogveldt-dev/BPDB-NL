// Bierkoers op Cloudflare Pages: een bewaarkopie van de sessie in een HttpOnly-cookie, zodat een speler (ook zonder
// account) terugkomt als de browser zijn opslag wist. Safari wist opslag van een website na 7 dagen zonder bezoek
// (niet in de app op het beginscherm); een cookie die de server zet, valt daar niet onder. Zelfde idee als DBDB.
// Alleen /api/sessie komt hier (zie _routes.json); de rest van de app zijn gewone bestanden.
//
// PUT    { refresh_token }  bewaar de vernieuwingssleutel van de huidige sessie in de cookie
// POST                      herstel: vernieuw de sessie bij Supabase met de cookie en geef hem terug
// DELETE                    wis de cookie (uitloggen)

// Gelijk aan app/config.js: openbare instellingen, geen geheimen
const SUPABASE_URL = "https://yzaootlrhxzyxtvacrot.supabase.co";
const SUPABASE_KEY = "sb_publishable_Nc0p9wvcJJWZN6rRYiBOyA_2QW3IPKs";
const KOEK = "bk_sessie";
const BEWAAR = 400 * 24 * 3600; // Chrome bewaart een cookie hooguit 400 dagen; bij elk bezoek zetten we hem opnieuw

function koek(waarde, maxAge) {
  return `${KOEK}=${waarde}; Max-Age=${maxAge}; Path=/api/sessie; HttpOnly; Secure; SameSite=Strict`;
}

function antwoord(status, body = null, cookie = null) {
  const headers = { "Cache-Control": "no-store" };
  if (body) headers["Content-Type"] = "application/json";
  if (cookie) headers["Set-Cookie"] = cookie;
  return new Response(body ? JSON.stringify(body) : null, { status, headers });
}

const geldig = (t) => typeof t === "string" && t.length >= 8 && t.length <= 2048 && /^[A-Za-z0-9._-]+$/.test(t);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/sessie") return env.ASSETS.fetch(request);
    // Alleen de app zelf: een andere website mag deze cookie niet zetten of uitlezen
    if (request.headers.get("Origin") !== url.origin) return antwoord(403, { fout: "Niet toegestaan" });

    if (request.method === "PUT") {
      const { refresh_token } = await request.json().catch(() => ({}));
      if (!geldig(refresh_token)) return antwoord(400, { fout: "Geen geldige sessie" });
      return antwoord(204, null, koek(refresh_token, BEWAAR));
    }
    if (request.method === "DELETE") return antwoord(204, null, koek("", 0));
    if (request.method !== "POST") return antwoord(405, { fout: "Niet toegestaan" });

    const token = (request.headers.get("Cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(KOEK + "="))?.slice(KOEK.length + 1);
    if (!geldig(token)) return antwoord(404, { fout: "Geen bewaarde sessie" });
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: token }),
    });
    // Sleutel verlopen, ingetrokken of al gebruikt: cookie weg. Bij een storing bij Supabase houden we hem.
    if (r.status >= 400 && r.status < 500) return antwoord(401, { fout: "Sessie verlopen" }, koek("", 0));
    if (!r.ok) return antwoord(502, { fout: "Supabase gaf geen antwoord" });
    const sessie = await r.json();
    return antwoord(200, sessie, geldig(sessie.refresh_token) ? koek(sessie.refresh_token, BEWAAR) : null);
  },
};
