# Wat Kjell zelf nog moet doen

Stappen die alleen in een dashboard kunnen. Precieze uitleg: `supabase/README.md`, stap 3. Doe stap 1 tot en met 4 voordat de nieuwe app live gaat.

## Inloggen: meteen beginnen, later e-mail koppelen

0. ~~**Nieuwe migratie `20261106150000_bevestigen_naar_betrouwbaarheid`.**~~ Gedaan op 6 november 2026: de rij staat in `supabase_migrations.schema_migrations` (versie `20261106150000`, naam `bevestigen_naar_betrouwbaarheid`). Gecontroleerd: `private.rond_af`, `private.meld_prijs` en de kolommen van `kroeg_kaart` zijn nieuw. Security Advisor: zie hieronder zodra gedraaid.
0. ~~**Migratie `20261106160000_vaste_spelersnaam`.**~~ Gedaan op 6 november 2026: staat op Supabase met versie `20261106160000`. Jouw naam Pils staat vast. Een naam wijzigen kan alleen nog in de SQL Editor. De Edge Function `osm-import` is opnieuw uitgerold (versie 2): probeert nu drie Overpass-servers en toont de echte foutreden. Security Advisor: alleen de bekende waarschuwing over gelekte wachtwoorden.
1. ~~**Migraties.**~~ Gedaan op 6 november 2026: `20261106090000_anonieme_spelers` en `20261106120000_extra_bier` staan op project `yzaootlrhxzyxtvacrot`, met de versies gelijk aan de bestandsnamen. De Security Advisor geeft alleen een waarschuwing over gelekte wachtwoorden; die doet er niet toe, want BPDB gebruikt geen wachtwoorden.
2. **Anonieme accounts.** Supabase, Authentication, Sign In / Providers: zet **Allow anonymous sign-ins** en **Allow manual linking** aan. Zonder deze stap kan niemand nieuw meedoen.
3. **Mailtemplates.** Authentication, Emails, Templates. Zet bij **Magic Link**, **Change Email Address** en **Confirm signup** het onderwerp `Je code voor de Kroegkaart` en de tekst uit `supabase/templates/inlogcode.html` (met `{{ .Token }}`). Zonder deze stap krijgt een speler een link in plaats van een code en kan hij in de app niets invullen.
4. **Eigen SMTP.** Authentication, Emails, SMTP Settings. Koppel Resend, Postmark of een andere mailprovider met een eigen afzender. Zonder deze stap krijgen alleen leden van je Supabase-team een mail, en maar een paar per uur.
5. **Rate limits.** Authentication, Rate Limits: zet het aantal mails per uur hoger zodra SMTP gekoppeld is. Nieuwe anonieme accounts staan standaard op 30 per uur per IP-adres; dat is genoeg.
6. **Adressen.** Authentication, URL Configuration: Site URL `https://bpdb-nl.pages.dev`, Redirect URLs `https://bpdb-nl.pages.dev/**` en `http://localhost:8765/**`.

## Inloggen met Apple en Google

De knoppen staan op slot tot de aanbieder in Supabase aanstaat; daarna gaan ze vanzelf open. Stappenplan: `docs/inloggen-met-apple-en-google.md`.

1. **Google:** project in Google Cloud, toestemmingsscherm, webclient, Client ID en secret in Supabase, Google aanzetten, app op In production.
2. **Apple:** lidmaatschap Apple Developer Program, Services ID en sleutel, geheime sleutel in Supabase, Apple aanzetten. De geheime sleutel verloopt na hoogstens 6 maanden.
3. **Privacyverklaring:** Google vraagt om een link. BPDB heeft er nog geen.

## Later

- **Captcha.** Supabase raadt een captcha aan bij anonieme accounts (Cloudflare Turnstile). Zet die pas aan in Supabase als de app hem meestuurt; anders werken beginnen en inloggen niet meer.
- **Opruimen.** Supabase ruimt oude anonieme accounts niet zelf op. Als het er veel worden, kunnen we een taak maken die accounts zonder punten na bijvoorbeeld 30 dagen verwijdert.
