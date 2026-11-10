# Wat Kjell zelf nog moet doen

Stappen die alleen in een dashboard kunnen. Precieze uitleg: `supabase/README.md`, stap 3. Doe stap 1 tot en met 4 voordat de nieuwe app live gaat.

## GitHub: main als standaardbranch

1. **Standaardbranch.** GitHub, repository BPDB-NL, Settings, General, Default branch: kies `main` (nu staat `claude/bpdb-concept-design-6gjlr6` als standaard). Nieuwe sessies beginnen dan vanaf `main` en pull requests gaan vanzelf naar `main`.
2. **Oude branches opruimen.** De lijst met per branch of hij al in `main` zit, staat in de pull request "Menukaartpijplijn 5". Na stap 1 kunnen de branches die al in `main` zitten weg (Settings, General, vink **Automatically delete head branches** aan voor de toekomst).

## Domein bierkoers.nl

Geregistreerd bij Vimexx op 6 november 2026. De DNS staat bij Cloudflare (nameservers `jocelyn.ns.cloudflare.com` en `kip.ns.cloudflare.com`): DNS-records wijzig je dus in Cloudflare, niet bij Vimexx.

1. ~~**Domein in Cloudflare, nameservers en koppelen aan de app (stap 1 tot en met 4).**~~ Gedaan: op 9 november 2026 gecontroleerd dat `https://bierkoers.nl` de app toont via Cloudflare.
5. **DNSSEC weer aan**, nu via Cloudflare (DNS, Settings), en zet de DS-record die Cloudflare geeft bij Vimexx.
6. ~~**Supabase-adressen bijwerken.**~~ Gedaan: op 10 november 2026 gecontroleerd dat de Site URL `https://bierkoers.nl` is en dat de Redirect URLs `https://bpdb-nl.pages.dev/**`, `https://bierkoers.nl/**`, `https://www.bierkoers.nl/**` en `http://localhost:8765/**` zijn. Nog open: bij inloggen met Apple en Google ook het nieuwe domein toevoegen.

## Inloggen: meteen beginnen, later e-mail koppelen

0. ~~**Migratie `20261106220000_betrouwbaarheid_verwachting`.**~~ Gedaan op 6 november 2026: staat op Supabase met versie `20261106220000`. Voorlopig: **Kjell is er nog niet tevreden over** (zie `docs/concept.md`, 2.6). Gecontroleerd: `pas_betrouwbaarheid_aan` gebruikt de nieuwe regel, spelers kunnen `betrouwbaarheid_na` niet zelf aanroepen, er staat nu niemand boven 90%. Security Advisor: alleen de bekende waarschuwing over gelekte wachtwoorden.
0. ~~**Migratie `20261106210000_inchecken`.**~~ Gedaan op 6 november 2026: staat op Supabase met versie `20261106210000` (eerst toegepast als `20261106140243`, daarna gelijkgezet aan de bestandsnaam). Gecontroleerd: RLS aan op `incheckingen`, alleen `authenticated` mag lezen en wissen, `inchecken` niet voor `anon`, trigger `incheck_bij_gebeurtenis` staat erop. Security Advisor: alleen de bekende waarschuwing over gelekte wachtwoorden.
0. ~~**Menukaartprijzen.**~~ Gedaan op 6 november 2026: migratie `20261106200000_menukaartprijzen` staat op Supabase met versie `20261106200000`. Eerste menukaartprijs ingevoerd: Stadscafé Jan, Hertog Jan vaasje €3,90, kaart van 20 december 2025. Security Advisor: alleen de bekende waarschuwing over gelekte wachtwoorden.
0. ~~**Google-kroegen, openingstijden en sluiten.**~~ Gedaan op 6 november 2026: migraties `20261106170000_google_kroegen`, `20261106180000_google_koppeling` en `20261106190000_kroeg_meldingen` staan op Supabase, met de versies gelijk aan de bestandsnamen. Daarna 138 kroegen uit Google Maps geïmporteerd: 61 gekoppeld aan een OSM-kroeg, 77 nieuw. Nijmegen heeft nu 165 open kroegen, 126 met openingstijden. Gecontroleerd: alle Place ID's en openingstijden gelijk aan de bron, elke kroeg in een wijk. Security Advisor: alleen de bekende waarschuwing over gelekte wachtwoorden.

0. ~~**Nieuwe migratie `20261106150000_bevestigen_naar_betrouwbaarheid`.**~~ Gedaan op 6 november 2026: de rij staat in `supabase_migrations.schema_migrations` (versie `20261106150000`, naam `bevestigen_naar_betrouwbaarheid`). Gecontroleerd: `private.rond_af`, `private.meld_prijs` en de kolommen van `kroeg_kaart` zijn nieuw. Security Advisor: zie hieronder zodra gedraaid.
0. ~~**Migratie `20261106160000_vaste_spelersnaam`.**~~ Gedaan op 6 november 2026: staat op Supabase met versie `20261106160000`. Jouw naam Pils staat vast. Een naam wijzigen kan alleen nog in de SQL Editor. De Edge Function `osm-import` is opnieuw uitgerold (versie 2): probeert nu drie Overpass-servers en toont de echte foutreden. Security Advisor: alleen de bekende waarschuwing over gelekte wachtwoorden.
1. ~~**Migraties.**~~ Gedaan op 6 november 2026: `20261106090000_anonieme_spelers` en `20261106120000_extra_bier` staan op project `yzaootlrhxzyxtvacrot`, met de versies gelijk aan de bestandsnamen. De Security Advisor geeft alleen een waarschuwing over gelekte wachtwoorden; die doet er niet toe, want Bierkoers gebruikt geen wachtwoorden.
2. ~~**Anonieme accounts.**~~ Gedaan: op 10 november 2026 gecontroleerd dat **Allow anonymous sign-ins** en **Allow manual linking** aanstaan.
3. ~~**Mailrecords in Cloudflare.**~~ Gedaan op 10 november 2026. De mail van Bierkoers loopt via Infomaniak (kSuite, adres `proost@bierkoers.nl`). In Cloudflare staan MX `mta-gw.infomaniak.ch` (prioriteit 5), SPF `v=spf1 include:spf.infomaniak.ch -all` en DKIM op `20261107._domainkey`; publiek gecontroleerd, de DKIM-sleutel is gelijk aan die in Infomaniak.
4. ~~**Eigen SMTP.**~~ Gedaan op 10 november 2026: afzender `proost@bierkoers.nl` (naam `Bierkoers`), host `mail.infomaniak.com`, poort `465`, gebruikersnaam `proost@bierkoers.nl`. Verandert het wachtwoord van dat adres, vul het dan ook hier opnieuw in (Authentication, Emails, SMTP Settings).
5. ~~**Mailtemplates.**~~ Gedaan op 10 november 2026: bij **Magic link or OTP**, **Confirm sign up** en **Change email address** het onderwerp `Je code voor Bierkoers` en de tekst uit `supabase/templates/inlogcode.html`.
6. ~~**Rate limits.**~~ Gedaan: mails staan sinds het koppelen van SMTP op 30 per uur, anonieme accounts op 30 per uur per IP-adres. Verhoog het aantal mails pas als het nodig is, en blijf onder het verzendlimiet van Infomaniak.
7. **Inloggen testen.** Vraag in de app een code aan met je eigen e-mailadres en kijk of de mail binnenkomt (niet in de spam) en of de code werkt. Test ook een nieuw anoniem account dat een e-mailadres koppelt.

## Inloggen met Apple en Google

De knoppen staan op slot tot de aanbieder in Supabase aanstaat; daarna gaan ze vanzelf open. Stappenplan: `docs/inloggen-met-apple-en-google.md`.

1. **Google:** project in Google Cloud, toestemmingsscherm, webclient, Client ID en secret in Supabase, Google aanzetten, app op In production.
2. **Apple:** lidmaatschap Apple Developer Program, Services ID en sleutel, geheime sleutel in Supabase, Apple aanzetten. De geheime sleutel verloopt na hoogstens 6 maanden.
3. **Privacyverklaring:** Google vraagt om een link. Bierkoers heeft er nog geen.

## Menukaartprijzen uit Google-foto's

1. **Run vanaf thuis, met de lokale modellen.** Claude draait dit in de sessie op je pc (`node menufotos.mjs --kroegen google-kroegen-nijmegen.json --sinds 2024-11-01`, standaard lokaal sinds 10 november 2026). Jij zorgt alleen dat de pc aan staat en de server van LM Studio draait (poort 1235). Importeren gaat met `--naar-supabase` en `SUPABASE_URL` en `SUPABASE_SERVICE_ROLE_KEY`, die jij zelf in je terminal zet, nooit in Git of in de chat. Vanuit een cloudsessie toont Google al na een paar kroegen een CAPTCHA.
2. **DeepSeek alleen als reserve (niet nodig).** Alleen voor als je echt iets gedaan wilt krijgen en de pc niet draait (`--extern`). Er staat $0,05 op; niet opwaarderen zolang het lokaal lukt. Wil je de reserve houden, maak dan een nieuwe sleutel aan: de oude stond in een chat.

## Testset voor de menukaartpijplijn

Zie `tools/google-kroegen/testset/README.md`. Alles op je eigen computer, vanaf een thuisverbinding.

1. **Foto-ID's zoeken.** Deels gedaan op 10 november 2026: de drie QR-bordjes van Café Van Buren en zeven foto's zonder bierprijzen staan in `testset/labels.json` (nog `gecontroleerd: false`, kijk ze na in `testset/fotos/<sleutel>/1600.jpg`). Nog open: het krijtbord van St. Anneke (2013) zat niet in de eerste 60 foto's, verder bladert Google niet; zoek het op in Google Maps en geef Claude de link. Stadscafé Jan heeft nog geen Place ID in de database: zoek de kroeg op in Google Maps.
2. **Drankkaart van Café Daen.** Zet de eerste pagina van de pdf als JPEG in `testset/fotos/daen-drankkaart/s0.jpg`.
3. **Aanvullen tot ongeveer twintig.** Ook foto's zonder kaart (eten, interieur), scheve en donkere foto's, krijtborden en gedrukte kaarten. Controleer elk label met de hand en zet `gecontroleerd` op `true`.
4. **Ophalen en meten.** `node testset/haal-fotos.mjs`, daarna `node testset/meet.mjs`.
5. **OCR meten.** `npm install` in `tools/google-kroegen` (zet tesseract.js en jpeg-js erbij, geen losse installatie nodig). Kijk in de uitslag van `meet.mjs` naar de regel `ocr`: staat `gemist` op 0, dan kan `--ocr filter` de standaard worden; anders blijft het `volgorde`.
6. **LM Studio.** Server aan op poort 1235 (Developer), Just-in-time loading aan. Draai de vier vergelijkingen uit `docs/lokale-vision.md` (Meten) en zet de uitslag in de tabel daar; Claude past daarna de standaard aan als een ander model beter is.

## Onderzoek: categorie Menu in Google Maps

Met de hand in Chrome, zie `docs/menukaartprijzen.md` (Onderzoek: alleen de categorie Menu ophalen): vergelijk het verzoek `hspqX` bij Alle en bij Menu voor twee kroegen en zet het verschil in dat document. Een cloudsessie kan dit niet.

## Nakijken van menukaartprijzen

Na een run met `menufotos.mjs` (zie `docs/menukaartprijzen.md`, Nakijken):

1. In Claude Code op je computer: laat de subagent menukaart-controleur de map `nakijken/<datum>` nakijken.
2. `node verwerk-oordelen.mjs nakijken/<datum>` en lees het rapport (vooral: hoe vaak zaten de modellen samen fout in de steekproef).
3. Importeren doe je zelf: `node verwerk-oordelen.mjs nakijken/<datum> --naar-supabase`, met `SUPABASE_URL` en `SUPABASE_SERVICE_ROLE_KEY` alleen in je eigen terminal.

## Later

- **Captcha.** Supabase raadt een captcha aan bij anonieme accounts (Cloudflare Turnstile). Zet die pas aan in Supabase als de app hem meestuurt; anders werken beginnen en inloggen niet meer.
- **Opruimen.** Supabase ruimt oude anonieme accounts niet zelf op. Als het er veel worden, kunnen we een taak maken die accounts zonder punten na bijvoorbeeld 30 dagen verwijdert.
