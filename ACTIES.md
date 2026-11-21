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

## Terraskaartje (bierkoers.nl/k)

1. ~~**Migratie `20261120143022_kaartscans`.**~~ Gedaan op 20 november 2026 in de SQL Editor. Security Advisor: een nieuwe waarschuwing, `rls_policy_always_true` op `kaartscans` (regel `scan toevoegen`). Die is bewust: iedereen mag een scan toevoegen, niemand mag lezen, wijzigen of wissen. Verder alleen de bekende waarschuwingen over anonieme spelers en gelekte wachtwoorden.
2. ~~**Testen op de echte site.**~~ Gedaan op 20 november 2026: `https://bierkoers.nl/k` op een telefoon gaf de eerste rij in `kaartscans` (`bron = kaartje`).

## Punten meteen

1. **Migratie `20261113180000_punten_meteen`** uitvoeren (SQL Editor, of laat Claude het doen via MCP en keur de vraag van Supabase goed) en de versie gelijkzetten aan `20261113180000`. Daarna de Security Advisor. De wachtende meldingen van Guinness123 en de bevestigingen van Pilsbaas024 krijgen dan meteen hun punten.

## Nieuwe stad aanvragen

1. ~~**Migratie `20261120170000_stadsaanvragen`.**~~ Gedaan op 20 november 2026: uitgevoerd via MCP, versie gelijkgezet aan `20261120170000`. Security Advisor: een nieuwe waarschuwing over anonieme spelers (de leesregel van `stadsaanvragen` geldt alleen voor beheerders), verder de bekende.
2. ~~**Edge Function `osm-import` opnieuw uitrollen.**~~ Gedaan op 20 november 2026 (versie 3, via MCP): ze zoekt nu zelf de gemeentecode op als die ontbreekt.
3. Aanvragen staan in de app onder Ik, Beheer, Stadsaanvragen. Goedkeuren laadt de kroegen en wijken; daarna staat de stad onder Ik, Stad.
4. ~~**Migratie `20261120190000_tijdlijn_gemeente`** (stadskeuze).~~ Gedaan op 20 november 2026 via MCP, versie gelijkgezet. Security Advisor: geen nieuwe waarschuwingen.

## Prijs vervangen (zonder "klopt niet")

Een andere prijs vervangt een openstaande melding, zonder straf voor de melder. Staat gebouwd in de pull request, maar werkt pas als de migratie op Supabase staat.

1. **Migratie `20261121140000_prijs_vervangen`** uitvoeren (laat Claude het doen via MCP, of de SQL Editor) en de versie gelijkzetten aan `20261121140000`. Het zijn twee dingen: een nieuwe waarde `vervangen` voor `gebeurtenis_status` (kan niet meer terug) en een aangepaste `meld_prijs`. Daarna de Security Advisor.
2. **Controleren op de echte site.** Open een kroeg met een melding die op bevestiging wacht, kies "Is de prijs gewijzigd? Geef de nieuwe prijs door" en geef een andere prijs door. De oude melding moet in de geschiedenis als "vervangen" staan en de melder houdt zijn punten.

## Mail bij een nieuwe bug of stadsaanvraag

De app mailt je zodra een speler een bug meldt of een stad aanvraagt, naar `proost@bierkoers.nl` (Infomaniak). Tot je dit doet, gebeurt er niets bijzonders: de melding staat gewoon onder Ik, Beheer.

1. ~~**Migratie `20261121100000_meldingen_mailen`.**~~ Gedaan op 21 november 2026: uitgevoerd via MCP, versie gelijkgezet aan `20261121100000`. `claim_melding_mail` mag alleen de `service_role` aanroepen. Security Advisor: alleen de bekende waarschuwingen over anonieme spelers (nu ook voor `bugmeldingen` en `stadsaanvragen`, bewust: alleen beheerders lezen) en gelekte wachtwoorden.
2. **Apparaatwachtwoord voor deze mails.** Infomaniak, mailbox `proost@bierkoers.nl`, nieuw apparaatwachtwoord (bijvoorbeeld "Bierkoers meldingen"). Hergebruik niet dat van "Supabase Bierkoers", dan kun je ze los van elkaar intrekken.
3. **Secret zetten.** Supabase, Edge Functions, Secrets: `SMTP_WACHTWOORD` met dat wachtwoord. Optioneel `MELDING_NAAR` als de mail ergens anders heen moet; standaard gaat hij naar dezelfde mailbox.
4. ~~**Edge Function `melding-mail` uitrollen.**~~ Gedaan op 21 november 2026 (versie 1, via MCP, `verify_jwt` aan). Zonder `SMTP_WACHTWOORD` antwoordt ze 500 "De functie mist haar instellingen" en claimt ze niets; zo gecontroleerd.
5. **Testen op de echte site.** Meld onder Ik een bug en vraag een stad aan. Binnen een minuut moet er een mail van `Bierkoers <proost@bierkoers.nl>` staan. Komt er niets, kijk dan in Supabase, Edge Functions, `melding-mail`, Logs. Dit is niet lokaal getest: er was geen Deno en geen wachtwoord, alleen de mailtekst en de databaseregels zijn getest.

## Bugs melden

1. ~~**Migratie `20261113120000_bugmeldingen`.**~~ Gedaan op 13 november 2026: uitgevoerd via MCP, versie gelijkgezet aan `20261113120000`. Security Advisor: alleen de bekende waarschuwingen over anonieme spelers (de leesregel van `bugmeldingen` geldt alleen voor beheerders) en gelekte wachtwoorden. De meldingen lees je in de app onder Ik, Beheer, Bugs, of in de Table Editor (`bugmeldingen`).

## Inloggen: meteen beginnen, later e-mail koppelen

0. ~~**Migratie `20261106220000_betrouwbaarheid_verwachting`.**~~ Gedaan op 6 november 2026: staat op Supabase met versie `20261106220000`. Voorlopig: **Kjell is er nog niet tevreden over** (zie `docs/concept.md`, 2.6). Gecontroleerd: `pas_betrouwbaarheid_aan` gebruikt de nieuwe regel, spelers kunnen `betrouwbaarheid_na` niet zelf aanroepen, er staat nu niemand boven 90%. Security Advisor: alleen de bekende waarschuwing over gelekte wachtwoorden.
0. ~~**Migratie `20261106210000_inchecken`.**~~ Gedaan op 6 november 2026: staat op Supabase met versie `20261106210000` (eerst toegepast als `20261106140243`, daarna gelijkgezet aan de bestandsnaam). Gecontroleerd: RLS aan op `incheckingen`, alleen `authenticated` mag lezen en wissen, `inchecken` niet voor `anon`, trigger `incheck_bij_gebeurtenis` staat erop. Security Advisor: alleen de bekende waarschuwing over gelekte wachtwoorden.
0. ~~**Menukaartprijzen.**~~ Gedaan op 6 november 2026: migratie `20261106200000_menukaartprijzen` staat op Supabase met versie `20261106200000`. Eerste menukaartprijs ingevoerd: Stadscafé Jan, Hertog Jan vaasje €3,90, kaart van 20 december 2025. Security Advisor: alleen de bekende waarschuwing over gelekte wachtwoorden.
0. ~~**Google-kroegen, openingstijden en sluiten.**~~ Gedaan op 6 november 2026: migraties `20261106170000_google_kroegen`, `20261106180000_google_koppeling` en `20261106190000_kroeg_meldingen` staan op Supabase, met de versies gelijk aan de bestandsnamen. Daarna 138 kroegen uit Google Maps geïmporteerd: 61 gekoppeld aan een OSM-kroeg, 77 nieuw. Nijmegen heeft nu 165 open kroegen, 126 met openingstijden. Gecontroleerd: alle Place ID's en openingstijden gelijk aan de bron, elke kroeg in een wijk. Security Advisor: alleen de bekende waarschuwing over gelekte wachtwoorden.

0. ~~**Nieuwe migratie `20261106150000_bevestigen_naar_betrouwbaarheid`.**~~ Gedaan op 6 november 2026: de rij staat in `supabase_migrations.schema_migrations` (versie `20261106150000`, naam `bevestigen_naar_betrouwbaarheid`). Gecontroleerd: `private.rond_af`, `private.meld_prijs` en de kolommen van `kroeg_kaart` zijn nieuw. Security Advisor: zie hieronder zodra gedraaid.
0. ~~**Migratie `20261106160000_vaste_spelersnaam`.**~~ Gedaan op 6 november 2026: staat op Supabase met versie `20261106160000`. Jouw naam Pils staat vast. Een naam wijzigen kan alleen nog in de SQL Editor. De Edge Function `osm-import` is opnieuw uitgerold (versie 2): probeert nu drie Overpass-servers en toont de echte foutreden. Security Advisor: alleen de bekende waarschuwing over gelekte wachtwoorden.
1. ~~**Migraties.**~~ Gedaan op 6 november 2026: `20261106090000_anonieme_spelers` en `20261106120000_extra_bier` staan op project `yzaootlrhxzyxtvacrot`, met de versies gelijk aan de bestandsnamen. De Security Advisor geeft alleen een waarschuwing over gelekte wachtwoorden; die doet er niet toe, want Bierkoers gebruikt geen wachtwoorden.
0. ~~**Versies gelijkzetten.**~~ Gedaan op 10 november 2026: `willekeurige_spelersnaam` staat op `20261110120000` en `samenvoegen` op `20261110130000`, gelijk aan de bestandsnamen.
0. ~~**Samenvoegen.**~~ Gedaan op 10 november 2026: migratie `samenvoegen` uitgevoerd (alleen `service_role` mag `voeg_samen` aanroepen, `anon` en `authenticated` niet) en de Edge Function `samenvoegen` uitgerold (`verify_jwt` aan; versie 2 is de code uit de repo). Gecontroleerd: zonder gegevens geeft de functie 400, zonder echte sessie 401. Security Advisor: alleen de bekende waarschuwingen over anonieme spelers (ze lezen en wissen hun eigen check-ins, naam en foto's) en gelekte wachtwoorden.
2. ~~**Anonieme accounts.**~~ Gedaan: op 10 november 2026 gecontroleerd dat **Allow anonymous sign-ins** en **Allow manual linking** aanstaan.
3. ~~**Mailrecords in Cloudflare.**~~ Gedaan op 10 november 2026. De mail van Bierkoers loopt via Infomaniak (kSuite, adres `proost@bierkoers.nl`). In Cloudflare staan MX `mta-gw.infomaniak.ch` (prioriteit 5), SPF `v=spf1 include:spf.infomaniak.ch -all` en DKIM op `20261107._domainkey`; publiek gecontroleerd, de DKIM-sleutel is gelijk aan die in Infomaniak.
4. ~~**Eigen SMTP.**~~ Gedaan op 10 november 2026: afzender `proost@bierkoers.nl` (naam `Bierkoers`), host `mail.infomaniak.com`, poort `465`, gebruikersnaam `proost@bierkoers.nl`. Het wachtwoord is een apparaatwachtwoord van Infomaniak (apparaat "Supabase Bierkoers"); maak je een nieuw aan, vul het dan ook hier opnieuw in (Authentication, Emails, SMTP Settings).
5. ~~**Mailtemplates.**~~ Gedaan op 10 november 2026: bij **Magic link or OTP**, **Confirm sign up** en **Change email address** het onderwerp `Je code voor Bierkoers` en de tekst uit `supabase/templates/inlogcode.html`.
6. ~~**Rate limits.**~~ Gedaan: mails staan sinds het koppelen van SMTP op 30 per uur, anonieme accounts op 30 per uur per IP-adres. Verhoog het aantal mails als nieuwe spelers zich via inloggen aanmelden en de 30 per uur te krap worden, en blijf onder het verzendlimiet van Infomaniak.
7. ~~**Inloggen testen.**~~ Gedaan op 10 november 2026: code kwam aan en werkte. Nog testen na de uitrol van deze versie: onder Ik, Al een account?, inloggen met een e-mailadres zonder account, dan Maak account en stuur code, de code invullen en een eigen naam kiezen. Doe dat een keer zonder bijdragen en een keer na een eerste bijdrage (dan moeten de punten meegaan).

## Inloggen met Apple en Google

De knoppen staan op slot tot de aanbieder in Supabase aanstaat; daarna gaan ze vanzelf open. Stappenplan: `docs/inloggen-met-apple-en-google.md`.

1. **Google:** project in Google Cloud, toestemmingsscherm, webclient, Client ID en secret in Supabase, Google aanzetten, app op In production.
2. **Apple:** lidmaatschap Apple Developer Program, Services ID en sleutel, geheime sleutel in Supabase, Apple aanzetten. De geheime sleutel verloopt na hoogstens 6 maanden.
3. **Privacyverklaring:** Google vraagt om een link. Bierkoers heeft er nog geen.

## Menukaartprijzen uit Google-foto's

1. **Run vanaf thuis, met de lokale modellen.** Claude draait dit in de sessie op je pc (`node menufotos.mjs --kroegen google-kroegen-nijmegen.json --sinds 2024-11-01`, standaard lokaal sinds 10 november 2026). Jij zorgt alleen dat de pc aan staat en de server van LM Studio draait (poort 1235). Importeren gaat met `--naar-supabase` en `SUPABASE_URL` en `SUPABASE_SERVICE_ROLE_KEY`, die jij zelf in je terminal zet, nooit in Git of in de chat. Vanuit een cloudsessie toont Google al na een paar kroegen een CAPTCHA.
2. **DeepSeek alleen als reserve (niet nodig).** Alleen voor als je echt iets gedaan wilt krijgen en de pc niet draait (`--extern`). Er staat $0,05 op; niet opwaarderen zolang het lokaal lukt. Wil je de reserve houden, maak dan een nieuwe sleutel aan: de oude stond in een chat.

## Testset voor de menukaartpijplijn

Doet Claude als manager (`docs/menukaart-manager.md`, stap 1a). Jij hoeft alleen te helpen als Claude iets vraagt, zoals de Place ID van Stadscafé Jan of de drankkaart van Café Daen.

## Onderzoek: categorie Menu in Google Maps

Met de hand in Chrome, zie `docs/menukaartprijzen.md` (Onderzoek: alleen de categorie Menu ophalen): vergelijk het verzoek `hspqX` bij Alle en bij Menu voor twee kroegen en zet het verschil in dat document. Een cloudsessie kan dit niet.

## Nakijken van menukaartprijzen

Na een run met `menufotos.mjs` (zie `docs/menukaartprijzen.md`, Nakijken):

1. In Claude Code op je computer: laat de subagent menukaart-controleur de map `nakijken/<datum>` nakijken.
2. `node verwerk-oordelen.mjs nakijken/<datum>` en lees het rapport (vooral: hoe vaak zaten de modellen samen fout in de steekproef).
3. Importeren doe je zelf: `node verwerk-oordelen.mjs nakijken/<datum> --naar-supabase`, met `SUPABASE_URL` en `SUPABASE_SERVICE_ROLE_KEY` alleen in je eigen terminal.

## Later

- **Captcha.** Supabase raadt een captcha aan bij anonieme accounts (Cloudflare Turnstile). Zet die pas aan in Supabase als de app hem meestuurt; anders werken beginnen en inloggen niet meer.
- **Opruimen.** Supabase ruimt oude anonieme accounts niet zelf op. Een anoniem account ontstaat pas bij de eerste bijdrage, dus lege accounts zijn zeldzaam. Dan kunnen we een taak maken die anonieme accounts zonder punten en check-ins na bijvoorbeeld 30 dagen verwijdert.
