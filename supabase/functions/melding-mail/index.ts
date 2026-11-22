// Mailt de beheerder over een nieuw bericht (soort "bug") of een stadsaanvraag, via de Infomaniak-mailbox van Bierkoers.
// De app roept deze functie aan nadat de speler de melding deed (meld_bug of vraag_stad_aan). Wie de melding
// deed, volgt uit de sessie (Authorization), nooit uit het verzoek; elke melding wordt hoogstens een keer
// gemaild (public.claim_melding_mail).
//
// POST /functions/v1/melding-mail
// Authorization: Bearer <sessie van de speler>
// { "soort": "bug" | "stad", "id": <id van de melding> }
//
// Instellingen (Edge Functions, Secrets): SMTP_WACHTWOORD is verplicht (apparaatwachtwoord van Infomaniak).
// Optioneel: SMTP_GEBRUIKER (standaard proost@bierkoers.nl), SMTP_HOST (standaard mail.infomaniak.com) en
// MELDING_NAAR (standaard dezelfde mailbox). Poort 465: Supabase laat 25 en 587 niet door.

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import nodemailer from "npm:nodemailer@6.9.16";
import { maakMail } from "./mail.ts";

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
  const wachtwoord = Deno.env.get("SMTP_WACHTWOORD") ?? "";
  const gebruiker = Deno.env.get("SMTP_GEBRUIKER") ?? "proost@bierkoers.nl";
  const host = Deno.env.get("SMTP_HOST") ?? "mail.infomaniak.com";
  const naar = Deno.env.get("MELDING_NAAR") ?? gebruiker;
  // Eerst de instellingen: zonder wachtwoord claimen we niets, anders raakt de melding gemarkeerd zonder mail.
  if (!url || !serviceKey || !wachtwoord) return antwoord({ fout: "De functie mist haar instellingen" }, 500);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const body = await req.json().catch(() => ({}));
  const soort = body?.soort;
  const id = Number(body?.id);
  if (!jwt || (soort !== "bug" && soort !== "stad") || !Number.isSafeInteger(id) || id < 1) {
    return antwoord({ fout: "Gegevens ontbreken" }, 400);
  }

  const { data: auth } = await admin.auth.getUser(jwt);
  if (!auth?.user) return antwoord({ fout: "Niet ingelogd" }, 401);

  const { data: melding, error } = await admin.rpc("claim_melding_mail", { p_soort: soort, p_id: id, p_door: auth.user.id });
  if (error) return antwoord({ fout: "De melding kon niet worden opgehaald" }, 500);
  if (!melding) return antwoord({ ok: true, verstuurd: false }); // al gemaild, niet van deze speler, of te oud

  try {
    // Heeft de speler een e-mailadres, dan wordt dat het antwoordadres: de beheerder antwoordt gewoon op de mail.
    // Het adres komt uit de sessie, nooit uit het verzoek.
    const email = auth.user.is_anonymous ? "" : (auth.user.email ?? "");
    const { onderwerp, tekst } = maakMail(melding, !!email);
    const verbinding = nodemailer.createTransport({
      host,
      port: 465,
      secure: true,
      auth: { user: gebruiker, pass: wachtwoord },
      connectionTimeout: 10000,
    });
    await verbinding.sendMail({ from: `Bierkoers <${gebruiker}>`, to: naar, subject: onderwerp, text: tekst, ...(email ? { replyTo: email } : {}) });
  } catch (e) {
    // Versturen mislukt: de melding weer vrijgeven, zodat een volgende poging kan lukken
    await admin.from(soort === "bug" ? "bugmeldingen" : "stadsaanvragen").update({ gemaild_op: null }).eq("id", id);
    console.error("melding-mail: versturen mislukt", e instanceof Error ? e.message : e);
    return antwoord({ fout: "De mail kon niet worden verstuurd" }, 502);
  }
  return antwoord({ ok: true, verstuurd: true });
});
