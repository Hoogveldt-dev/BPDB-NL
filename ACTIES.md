# Wat Kjell zelf nog moet doen

Stappen die alleen in een dashboard kunnen. Precieze uitleg: `supabase/README.md`, stap 3. Doe stap 1 tot en met 4 voordat de nieuwe app live gaat.

## GitHub: main als standaardbranch

1. **Standaardbranch.** GitHub, repository BPDB-NL, Settings, General, Default branch: kies `main` (nu staat `claude/bpdb-concept-design-6gjlr6` als standaard). Nieuwe sessies beginnen dan vanaf `main` en pull requests gaan vanzelf naar `main`.
2. **Oude branches opruimen.** Alle oude branches zijn al volledig samengevoegd in `main`. Na stap 1 kunnen ze weg (Settings, General, vink **Automatically delete head branches** aan voor de toekomst).

## Domein bierkoers.nl

Geregistreerd bij Vimexx op 6 november 2026. Daar staan nu de nameservers van Vimexx (`dns1.p01.nsone.net` tot en met `dns3`).

1. ~~**Domein in Cloudflare, nameservers en koppelen aan de app (stap 1 tot en met 4).**~~ Gedaan: op 9 november 2026 gecontroleerd dat `https://bierkoers.nl` de app toont via Cloudflare.
5. **DNSSEC weer aan**, nu via Cloudflare (DNS, Settings), en zet de DS-record die Cloudflare geeft bij Vimexx.
6. **Supabase-adressen bijwerken.** Authentication, URL Configuration: Site URL `https://bierkoers.nl`, en voeg `https://bierkoers.nl/**` toe aan de Redirect URLs. Laat `https://bpdb-nl.pages.dev/**` staan. Bij inloggen met Apple en Google ook het nieuwe domein toevoegen.

## Inloggen: meteen beginnen, later e-mail koppelen

0. ~~**Migratie `20261106220000_betrouwbaarheid_verwachting`.**~~ Gedaan op 6 november 2026: staat op Supabase met versie `20261106220000`. Voorlopig: **Kjell is er nog niet tevreden over** (zie `docs/concept.md`, 2.6). Gecontroleerd: `pas_betrouwbaarheid_aan` gebruikt de nieuwe regel, spelers kunnen `betrouwbaarheid_na` niet zelf aanroepen, er staat nu niemand boven 90%. Security Advisor: alleen de bekende waarschuwing over gelekte wachtwoorden.
0. ~~**Migratie `20261106210000_inchecken`.**~~ Gedaan op 6 november 2026: staat op Supabase met versie `20261106210000` (eerst toegepast als `20261106140243`, daarna gelijkgezet aan de bestandsnaam). Gecontroleerd: RLS aan op `incheckingen`, alleen `authenticated` mag lezen en wissen, `inchecken` niet voor `anon`, trigger `incheck_bij_gebeurtenis` staat erop. Security Advisor: alleen de bekende waarschuwing over gelekte wachtwoorden.
0. ~~**Menukaartprijzen.**~~ Gedaan op 6 november 2026: migratie `20261106200000_menukaartprijzen` staat op Supabase met versie `20261106200000`. Eerste menukaartprijs ingevoerd: Stadscafé Jan, Hertog Jan vaasje €3,90, kaart van 20 december 2025. Security Advisor: alleen de bekende waarschuwing over gelekte wachtwoorden.
0. ~~**Google-kroegen, openingstijden en sluiten.**~~ Gedaan op 6 november 2026: migraties `20261106170000_google_kroegen`, `20261106180000_google_koppeling` en `20261106190000_kroeg_meldingen` staan op Supabase, met de versies gelijk aan de bestandsnamen. Daarna 138 kroegen uit Google Maps geïmporteerd: 61 gekoppeld aan een OSM-kroeg, 77 nieuw. Nijmegen heeft nu 165 open kroegen, 126 met openingstijden. Gecontroleerd: alle Place ID's en openingstijden gelijk aan de bron, elke kroeg in een wijk. Security Advisor: alleen de bekende waarschuwing over gelekte wachtwoorden.

0. ~~**Nieuwe migratie `20261106150000_bevestigen_naar_betrouwbaarheid`.**~~ Gedaan op 6 november 2026: de rij staat in `supabase_migrations.schema_migrations` (versie `20261106150000`, naam `bevestigen_naar_betrouwbaarheid`). Gecontroleerd: `private.rond_af`, `private.meld_prijs` en de kolommen van `kroeg_kaart` zijn nieuw. Security Advisor: zie hieronder zodra gedraaid.
0. ~~**Migratie `20261106160000_vaste_spelersnaam`.**~~ Gedaan op 6 november 2026: staat op Supabase met versie `20261106160000`. Jouw naam Pils staat vast. Een naam wijzigen kan alleen nog in de SQL Editor. De Edge Function `osm-import` is opnieuw uitgerold (versie 2): probeert nu drie Overpass-servers en toont de echte foutreden. Security Advisor: alleen de bekende waarschuwing over gelekte wachtwoorden.
1. ~~**Migraties.**~~ Gedaan op 6 november 2026: `20261106090000_anonieme_spelers` en `20261106120000_extra_bier` staan op project `yzaootlrhxzyxtvacrot`, met de versies gelijk aan de bestandsnamen. De Security Advisor geeft alleen een waarschuwing over gelekte wachtwoorden; die doet er niet toe, want Bierkoers gebruikt geen wachtwoorden.
2. **Anonieme accounts.** Supabase, Authentication, Sign In / Providers: zet **Allow anonymous sign-ins** en **Allow manual linking** aan. Zonder deze stap kan niemand nieuw meedoen.
3. **Mailtemplates.** Authentication, Emails, Templates. Zet bij **Magic Link**, **Change Email Address** en **Confirm signup** het onderwerp `Je code voor Bierkoers` (in `supabase/config.toml`: `Je inlogcode voor Bierkoers`) en de tekst uit `supabase/templates/inlogcode.html` (met `{{ .Token }}`). Zonder deze stap krijgt een speler een link in plaats van een code en kan hij in de app niets invullen.
4. **Eigen SMTP.** Authentication, Emails, SMTP Settings. Koppel Resend, Postmark of een andere mailprovider met een eigen afzender. Zonder deze stap krijgen alleen leden van je Supabase-team een mail, en maar een paar per uur.
5. **Rate limits.** Authentication, Rate Limits: zet het aantal mails per uur hoger zodra SMTP gekoppeld is. Nieuwe anonieme accounts staan standaard op 30 per uur per IP-adres; dat is genoeg.
6. **Adressen.** Authentication, URL Configuration: Site URL `https://bpdb-nl.pages.dev`, Redirect URLs `https://bpdb-nl.pages.dev/**` en `http://localhost:8765/**`.

## Inloggen met Apple en Google

De knoppen staan op slot tot de aanbieder in Supabase aanstaat; daarna gaan ze vanzelf open. Stappenplan: `docs/inloggen-met-apple-en-google.md`.

1. **Google:** project in Google Cloud, toestemmingsscherm, webclient, Client ID en secret in Supabase, Google aanzetten, app op In production.
2. **Apple:** lidmaatschap Apple Developer Program, Services ID en sleutel, geheime sleutel in Supabase, Apple aanzetten. De geheime sleutel verloopt na hoogstens 6 maanden.
3. **Privacyverklaring:** Google vraagt om een link. Bierkoers heeft er nog geen.

## Menukaartprijzen uit Google-foto's

1. **Run vanaf thuis.** Op je eigen computer, in `tools/google-kroegen`: `npm install`, `npx playwright install chromium`, dan `DEEPSEEK_API_KEY=<sleutel> node menufotos.mjs --kroegen google-kroegen-nijmegen.json --sinds 2024-11-01`. Eerst `node cli.mjs --gemeentecode GM0268` voor dat bestand. Bekijk `menuprijzen.json` en importeer met `--naar-supabase` (met `SUPABASE_URL` en `SUPABASE_SERVICE_ROLE_KEY`, nooit in git). Vanuit een cloudsessie toont Google al na een paar kroegen een CAPTCHA.
2. **DeepSeek-tegoed.** Er staat $0,05 op. Dat is genoeg voor een proef; voor heel Nijmegen ruim een paar dollar opwaarderen. Maak ook een nieuwe sleutel aan: de oude stond in een chat.

## Testset voor de menukaartpijplijn

Zie `tools/google-kroegen/testset/README.md`. Alles op je eigen computer, vanaf een thuisverbinding.

1. **Foto-ID's zoeken.** Voor St. Anneke en Café Van Buren: `node testset/haal-fotos.mjs --kandidaten <place_id>`, open `overzicht.html` en zet het `foto_id` van het krijtbord en de drie QR-bordjes in `testset/labels.json`. Stadscafé Jan heeft nog geen Place ID in de database: zoek de kroeg op in Google Maps.
2. **Drankkaart van Café Daen.** Zet de eerste pagina van de pdf als JPEG in `testset/fotos/daen-drankkaart/s0.jpg`.
3. **Aanvullen tot ongeveer twintig.** Ook foto's zonder kaart (eten, interieur), scheve en donkere foto's, krijtborden en gedrukte kaarten. Controleer elk label met de hand en zet `gecontroleerd` op `true`.
4. **Ophalen en meten.** `node testset/haal-fotos.mjs`, daarna `node testset/meet.mjs`.
5. **LM Studio.** Server aan op poort 1235 (Developer), Just-in-time loading aan. Draai de vier vergelijkingen uit `docs/lokale-vision.md` (Meten) en zet de uitslag in de tabel daar; Claude past daarna de standaard aan als een ander model beter is.

## Later

- **Captcha.** Supabase raadt een captcha aan bij anonieme accounts (Cloudflare Turnstile). Zet die pas aan in Supabase als de app hem meestuurt; anders werken beginnen en inloggen niet meer.
- **Opruimen.** Supabase ruimt oude anonieme accounts niet zelf op. Als het er veel worden, kunnen we een taak maken die accounts zonder punten na bijvoorbeeld 30 dagen verwijdert.
