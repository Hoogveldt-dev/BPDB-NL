// Telt bezoeken via de QR-code op het terraskaartje en maakt de adresbalk schoon.
// Het kaartje verwijst naar bierkoers.nl/k. Dit script draait vóór app.js:
// het zet het adres direct terug naar "/" en stuurt één telling naar Supabase.
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

// Pad op het kaartje → bron in de database. Nieuwe drukwerkversie? Voeg hier een pad toe.
const BRONNEN = { "/k": "kaartje" };

const pad = location.pathname.replace(/\/+$/, "") || "/";
const bron = BRONNEN[pad];

if (bron) {
  // Adresbalk schoon, zonder extra stap in de geschiedenis (terug-knop werkt normaal).
  history.replaceState(history.state, "", "/" + location.hash);

  // Eén telling per bezoek. Omdat het adres nu "/" is, telt verversen niet opnieuw.
  fetch(`${SUPABASE_URL}/rest/v1/kaartscans`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ bron }),
    keepalive: true,
  }).catch(() => {
    // Telling mislukt (offline, adblocker): de app werkt gewoon door.
  });
}
