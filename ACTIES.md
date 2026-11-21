# Wat Kjell zelf nog moet doen

Stappen die alleen in een dashboard kunnen. Precieze uitleg: `supabase/README.md`, stap 3.

## Eerst: voor de demo aan vrienden (stand 21 november 2026)

Op volgorde van belang. Alles is op 21 november 2026 gecontroleerd tegen de live site, DNS of database.

1. ~~**Pull request van 21 november mergen.**~~ Gedaan: PR #47 gemerged. Live gecontroleerd op 21 november 2026: `https://bierkoers.nl/privacy`, het deelplaatje `og.png`, 204 op `/api/sessie` en `CACHE` `bierkoers-v57`.
2. ~~**Migratie `20261121220000_samenvoegen_fotos`.**~~ Gedaan op 21 november 2026 door Claude, via een eenmalige Edge Function omdat de Supabase-connector bij DDL om een bevestiging vraagt. Gecontroleerd: nieuwe `voeg_samen` staat erin, alleen `service_role` mag hem aanroepen, versie `20261121220000` staat in `schema_migrations`. Security Advisor: alleen de bekende waarschuwingen. De Edge Function `eenmalig-migratie` doet niets meer (410); je mag hem in het dashboard verwijderen (Edge Functions, eenmalig-migratie, Delete).
3. **DMARC in Cloudflare** (DNS, Records, Add record): type `TXT`, naam `_dmarc`, inhoud `v=DMARC1; p=none; rua=mailto:proost@bierkoers.nl`. Nu is er geen DMARC-record, en Gmail en Outlook zetten mail zonder DMARC eerder in de spam. Stuur daarna een inlogcode naar een Gmail-, iCloud- en Outlook-adres en kijk of hij in de inbox komt. Na een paar weken zonder problemen kun je `p=none` vervangen door `p=quarantine`.
4. **Inloggen met Google naar productie.** Google Cloud Console, APIs & Services, OAuth consent screen (Branding): vul bij Privacy policy `https://bierkoers.nl/privacy` in en bij Application home page `https://bierkoers.nl`; zet bij Audience de status op **In production**. Zolang hij op Testing staat, kunnen alleen testgebruikers met Google inloggen; vrienden krijgen dan een foutmelding. De knop staat al aan in de app (`external.google: true`). Niet te controleren vanuit een cloudsessie.
5. **www.bierkoers.nl doorsturen naar bierkoers.nl.** Nu geeft `www` een tweede kopie van de app (200). Cloudflare, Rules, Redirect Rules, Create rule, sjabloon "Redirect from WWW to root". Inloggen werkt daarna gewoon: de Redirect URL van `www` mag blijven staan.
6. ~~**De kapotte HEIC-foto bij Samson.**~~ Gedaan op 21 november 2026: rij `kroeg_fotos` id 1 en de 5 punten ervan verwijderd. Het bestand staat nog in de bucket `prijslijsten` (map `649b7305-...`); niemand ziet het meer. Wil je hem ook daar weg: Storage, `prijslijsten`, die map, het `.heic`-bestand.
7. **Privacyverklaring nalezen** (`app/privacy.html`). Contact is nu `proost@bierkoers.nl`, zonder naam. De AVG vraagt wie verantwoordelijk is; zet je naam (en eventueel woonplaats) erbij als je dat goed vindt. Klopt er iets niet, zeg het dan, dan pas ik het aan.
8. **Echte telefoon.** Op 21 november 2026 heeft Claude het anonieme pad op de live site getest in een iPhone-browser: zonder account een prijs melden (anonieme speler, +50), de bewaarcookie, en na het wissen van de browseropslag dezelfde speler terug via `/api/sessie`. Geen fouten; de testgegevens zijn verwijderd. Nog niet getest, en dat kan alleen jij: e-mail koppelen met een echte code, inloggen op een tweede toestel, bevestigen, en een foto (ook HEIC op Android) op een echte iPhone en Android.
9. ~~**Zaken die geen kroeg zijn.**~~ Gedaan op 21 november 2026: Dreadlock en Kronkel (coffeeshops aan de Vlaamsegas, volgens gemeentelijke vergunningen en In Your Pocket) en Park Café (vergunning voor droge horeca) gesloten met `gesloten_door_spelers = true`, zodat een nieuwe import ze niet heropent. Twijfel nog over Strik Bakkers Cafe (lijkt een ijssalon), Café Royal en café Billabong (bestaan mogelijk niet meer): kijk als je er langskomt, of meld ze in de app met "Klopt deze kroeg niet?".

## GitHub

1. ~~**Standaardbranch.**~~ Gedaan: op 21 november 2026 gecontroleerd dat `main` de standaardbranch is.
2. **Oude branches opruimen.** De lijst met per branch of hij al in `main` zit, staat in de pull request "Menukaartpijplijn 5". Na stap 1 kunnen de branches die al in `main` zitten weg (Settings, General, vink **Automatically delete head branches** aan voor de toekomst).

## Domein bierkoers.nl

Geregistreerd bij Vimexx op 6 november 2026. De DNS staat bij Cloudflare (nameservers `jocelyn.ns.cloudflare.com` en `kip.ns.cloudflare.com`): DNS-records wijzig je dus in Cloudflare, niet bij Vimexx.

1. ~~**Domein in Cloudflare, nameservers en koppelen aan de app (stap 1 tot en met 4).**~~ Gedaan: op 9 november 2026 gecontroleerd dat `https://bierkoers.nl` de app toont via Cloudflare.
5. **DNSSEC weer aan**, nu via Cloudflare (DNS, Settings), en zet de DS-record die Cloudflare geeft bij Vimexx. Op 21 november 2026 nog niet gedaan: .nl kent geen DS-record voor bierkoers.nl. Niet nodig voor de demo.
6. ~~**Supabase-adressen bijwerken.**~~ Gedaan: op 10 november 2026 gecontroleerd dat de Site URL `https://bierkoers.nl` is en dat de Redirect URLs `https://bpdb-nl.pages.dev/**`, `https://bierkoers.nl/**`, `https://www.bierkoers.nl/**` en `http://localhost:8765/**` zijn. Nog open: bij inloggen met Apple en Google ook het nieuwe domein toevoegen.

## Terraskaartje (bierkoers.nl/k)

1. ~~**Migratie `20261120143022_kaartscans`.**~~ Gedaan op 20 november 2026 in de SQL Editor. Security Advisor: een nieuwe waarschuwing, `rls_policy_always_true` op `kaartscans` (regel `scan toevoegen`). Die is bewust: iedereen mag een scan toevoegen, niemand mag lezen, wijzigen of wissen. Verder alleen de bekende waarschuwingen over anonieme spelers en gelekte wachtwoorden.
2. ~~**Testen op de echte site.**~~ Gedaan op 20 november 2026: `https://bierkoers.nl/k` op een telefoon gaf de eerste rij in `kaartscans` (`bron = kaartje`).

## Punten meteen

1. ~~**Migratie `20261113180000_punten_meteen`.**~~ Gedaan: op 21 november 2026 gecontroleerd dat de versie `20261113180000` in `schema_migrations` staat.

## Nieuwe stad aanvragen

1. ~~**Migratie `20261120170000_stadsaanvragen`.**~~ Gedaan op 20 november 2026: uitgevoerd via MCP, versie gelijkgezet aan `20261120170000`. Security Advisor: een nieuwe waarschuwing over anonieme spelers (de leesregel van `stadsaanvragen` geldt alleen voor beheerders), verder de bekende.
2. ~~**Edge Function `osm-import` opnieuw uitrollen.**~~ Gedaan op 20 november 2026 (versie 3, via MCP): ze zoekt nu zelf de gemeentecode op als die ontbreekt.
3. Aanvragen staan in de app onder Ik, Beheer, Stadsaanvragen. Goedkeuren laadt de kroegen en wijken; daarna staat de stad onder Ik, Stad.
4. ~~**Migratie `20261120190000_tijdlijn_gemeente`** (stadskeuze).~~ Gedaan op 20 november 2026 via MCP, versie gelijkgezet. Security Advisor: geen nieuwe waarschuwingen.

## Foto van de kaart

Een foto van de kaart bij een kroeg toevoegen, los van een prijs: +5 punten voor de eerste foto per kroeg, en je eigen foto verwijderen.

1. ~~**Migratie `20261121180000_kaartfotos`.**~~ Gedaan op 21 november 2026: uitgevoerd via MCP, versie gelijkgezet aan `20261121180000`. Gecontroleerd: RLS staat aan op `kroeg_fotos`, `anon` en `authenticated` mogen alleen lezen, `meld_foto` mag alleen `authenticated` (niet `anon`). Security Advisor: alleen de bekende waarschuwingen.
2. ~~**Migratie `20261121200000_kaartfotos_punten_verwijderen`** (punten en verwijderen).~~ Gedaan op 21 november 2026: door Kjell uitgevoerd in de SQL Editor, de versie daarna door Claude in `schema_migrations` gezet (`20261121200000`). Gecontroleerd: kolommen `punten` en `verwijderd_op` op `kroeg_fotos`, `punten.kaartfoto_id`, `verwijder_foto` alleen voor `authenticated`, leesregel `verwijderd_op is null`. Security Advisor: alleen de bekende waarschuwingen.
3. **Een ongepaste foto van een ander verwijderen** (spelers verwijderen alleen hun eigen foto) in de SQL Editor; de punten gaan er dan ook af. Daarna het bestand in Storage (bucket `prijslijsten`) verwijderen via het pad uit de eerste query:
   ```sql
   select id, pad, door_id from public.kroeg_fotos where verwijderd_op is null order by op desc;
   update public.kroeg_fotos set verwijderd_op = now() where id = 123;
   delete from public.punten where kaartfoto_id = 123;
   ```
4. **Controleren op de echte site.** Open een kroeg, tik op "Foto van de kaart toevoegen", kies een foto: je krijgt +5 en de foto staat onder "Foto's van de kaart". Verwijder hem met "Verwijderen": de punten gaan eraf.

## Prijs vervangen (zonder "klopt niet")

Een andere prijs vervangt een openstaande melding, zonder straf voor de melder. De migratie staat op Supabase; de app-wijziging zit in de pull request en werkt pas zodra die gemerged is.

1. ~~**Migratie `20261121140000_prijs_vervangen`.**~~ Gedaan op 21 november 2026: uitgevoerd via MCP, versie gelijkgezet aan `20261121140000`. Gecontroleerd: `gebeurtenis_status` heeft nu `vervangen`, kolom `vervangen_door` en de nieuwe `meld_prijs` staan erin, rechten onveranderd (`authenticated` ja, `anon` nee). Security Advisor: alleen de bekende waarschuwingen.
2. **Controleren op de echte site.** Open een kroeg met een melding die op bevestiging wacht, kies "Is de prijs gewijzigd? Geef de nieuwe prijs door" en geef een andere prijs door. De oude melding moet in de geschiedenis als "vervangen" staan en de melder houdt zijn punten.

## Mail bij een nieuwe bug of stadsaanvraag

De app mailt je zodra een speler een bug meldt of een stad aanvraagt, naar `proost@bierkoers.nl` (Infomaniak). Gedaan op 21 november 2026 en getest.

1. ~~**Migratie `20261121100000_meldingen_mailen`.**~~ Gedaan op 21 november 2026: uitgevoerd via MCP, versie gelijkgezet aan `20261121100000`. `claim_melding_mail` mag alleen de `service_role` aanroepen. Security Advisor: alleen de bekende waarschuwingen over anonieme spelers (nu ook voor `bugmeldingen` en `stadsaanvragen`, bewust: alleen beheerders lezen) en gelekte wachtwoorden.
2. ~~**Apparaatwachtwoord.**~~ Gedaan op 21 november 2026: apparaat "Meldingen" bij de mailbox `proost@bierkoers.nl` in Infomaniak. Dit wachtwoord is per ongeluk in een gesprek met Claude terechtgekomen (screenshot). Wil je het vervangen: nieuw apparaat aanmaken, het oude intrekken en het secret opnieuw zetten (stap 3).
3. ~~**Secret `SMTP_WACHTWOORD`.**~~ Gedaan op 21 november 2026 (Supabase, Edge Functions, Secrets). Optioneel `MELDING_NAAR`, `SMTP_GEBRUIKER` en `SMTP_HOST`; zonder die staat alles op `proost@bierkoers.nl` en `mail.infomaniak.com`.
4. ~~**Edge Function `melding-mail` uitrollen.**~~ Gedaan op 21 november 2026 (versie 1, via MCP, `verify_jwt` aan).
5. ~~**Testen.**~~ Gedaan op 21 november 2026 met een tijdelijke anonieme speler en een testbug: de functie antwoordde `verstuurd: true` en de melding stond daarna als gemaild. De testgegevens zijn verwijderd. Nog te doen door jou: kijk of de mail "Bierkoers: nieuwe bug gemeld" in `proost@bierkoers.nl` stond. Daarna werkt het voor elke bug en stadsaanvraag zodra de app uit de pull request live staat.

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
