# BPDB-NL (Kroegkaart)

Door gebruikers gevulde kaart met bierprijzen per kroeg. Spelers spelen samen de stad vrij en houden de prijzen vers. Pilotstad Nijmegen. De app is een PWA zonder build (`app/`), de backend draait op Supabase (`supabase/`). Besluiten en spelregels: `docs/concept.md`.

## Werkwijze
- Alle teksten in de app en in de documentatie in het Nederlands. Gebruik nooit gedachtestreepjes (het lange streepje).
- Draai na elke reeks wijzigingen `npm run check`. Na een wijziging in `supabase/migrations/` ook `npm run test:db`, en breid de test uit met de nieuwe regel.
- Test een wijziging in de app in een browser (`python3 -m http.server 8765 --directory app`), op telefoonbreedte.
- Commit na elke werkende stap met een duidelijke Nederlandse omschrijving.
- Wat Kjell zelf in een dashboard moet doen, staat in `ACTIES.md`. Houd dat bij.

## Belangrijke plekken
- App: `app/app.js` (kaart, inloggen, melden, bevestigen, ranglijst, realtime), `app/styles.css`, `app/index.html`, service worker `app/sw.js`. Verhoog `CACHE` in `sw.js` als de app-schil verandert.
- Openbare instellingen: `app/config.js` (project-URL en publishable key). Zet hier nooit de service_role-key, secret key of het databasewachtwoord.
- Database: `supabase/migrations/`, uitleg in `supabase/README.md`, test in `supabase/tests/database.test.mjs` (PGlite met PostGIS, bootst rollen, `auth.users`, `auth.uid()` en opslag na).
- Kroegimport uit OpenStreetMap en wijken van het CBS: Edge Function `supabase/functions/osm-import/`.
- Inloggen: nieuwe spelers beginnen anoniem (`startForm`, `signInAnonymously`) en koppelen later hun e-mailadres (`koppelForm`, `updateUser` en `verifyOtp` met `type: 'email_change'`). Bestaande spelers loggen in met een code (`loginForm`). Alles via `stuurCode` en `codeForm` in `app/app.js`; mailtekst in `supabase/templates/inlogcode.html`.

## Inloggen (lessen uit Woober, Woofer en DBDB)
- Meteen kunnen beginnen zonder account (het idee van DBDB), maar met een echt account van Supabase dat je later aan een e-mailadres koppelt, zodat punten niet verloren gaan.
- Anonieme spelers mogen prijzen melden, maar niet bevestigen, weerleggen of "klopt nog" doen (`private.vereis_email()`), en worden nooit direct bevestigd. Een nieuwe functie waarmee spelers elkaars werk goedkeuren, roept ook `private.vereis_email()` aan. In de app is dat `anoniem()`.
- Inloggen gaat met een code die de speler in de app typt (`signInWithOtp` en daarna `verifyOtp` met `type: 'email'`), niet met een link. `shouldCreateUser` staat uit: nieuwe spelers beginnen anoniem. Een link werkt maar een keer, wordt soms door virusscanners van mailprogramma's opgebruikt en opent op een iPhone in Safari in plaats van in de PWA op het beginscherm.
- De client gebruikt `flowType: 'pkce'`.
- Wacht nooit op een Supabase-aanroep binnen `onAuthStateChange`: supabase-js houdt dan een slot vast en de app kan vastlopen. Doe het werk in een `setTimeout(..., 0)`.
- Toon fouten van Supabase Auth via `vertaalAuthFout()` in gewone taal, nooit de Engelse melding.
- Teken het scherm niet opnieuw terwijl iemand typt (`bezigMetTypen()`); realtime-updates zouden de invoer anders wissen.
- Supabase stuurt zonder eigen SMTP alleen mail naar leden van het team en maar een paar per uur. Voor echte spelers is eigen SMTP nodig.

## Afspraken
- Iedereen mag alles lezen; schrijven gaat alleen via de functies `meld_prijs`, `beoordeel` en `klopt_nog`. Spelers kunnen alleen hun eigen naam wijzigen. Geef nooit direct schrijfrechten op `gebeurtenissen`, `bevestigingen`, `punten` of `kroegen`.
- Spellogica staat in het schema `private` als `security definer` met `set search_path = ''` en controleert zelf `auth.uid()`. Nieuwe functies: `revoke execute ... from public, anon` en alleen `grant` aan `authenticated` als de app ze aanroept. Autorisatie gebruikt nooit `user_metadata`.
- Spelregels (punten, bevestigen, uitschieters, betrouwbaarheid, 75 m ter plaatse) staan in `supabase/README.md` en de migratie. Wijzig ze alleen als Kjell erom vraagt, en dan migratie, README en test samen.
- We belonen bijdragen, nooit drinken. Spelers zijn 18 jaar of ouder.
- Toon andere spelers alleen de spelersnaam, nooit e-mail of locatie. Namen gaan in HTML altijd door `esc()`.
- Databasewijzigingen gaan via een nieuw bestand in `supabase/migrations/`; pas oude migraties nooit aan. Voer je een migratie met de hand uit (SQL-editor of MCP `apply_migration`), zet dan in `supabase_migrations.schema_migrations` de `version` gelijk aan de bestandsnaam. Draai daarna de beveiligingsadviezen van Supabase.
- Supabase-project `yzaootlrhxzyxtvacrot`, los van Woober en Woofer. Code uit die projecten overnemen mag (kopieer en pas aan); hun sleutels en projecten gebruik je nooit.
