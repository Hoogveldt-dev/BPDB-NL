# Acties voor de beheerder

Wat alleen in een dashboard, bij een registrar of op een echte telefoon kan. Hier staat alleen wat nog openstaat; afgeronde punten staan in de geschiedenis van Git. Hoe alles nu is ingesteld, staat onderaan. Algemene installatiestappen: `supabase/README.md`, stap 3.

## Voor de eerste spelers

1. **Inloggen met Google naar productie.** Google Cloud Console, APIs & Services, OAuth consent screen (Branding): Privacy policy `https://bierkoers.nl/privacy`, Application home page `https://bierkoers.nl`; zet bij Audience de status op **In production**. Zolang hij op Testing staat, kunnen alleen testgebruikers met Google inloggen. Een cloudsessie kan dit niet doen of controleren.
2. **bierkoers.nl in plaats van het Supabase-adres bij Google.** Google toont "Doorgaan naar yzaootlrhxzyxtvacrot.supabase.co" omdat de terugkeer-URL van Supabase is. Twee manieren: (a) in Google Cloud Console, Google Auth Platform, Branding de app-naam Bierkoers, het logo en het domein `bierkoers.nl` invullen en de branding laten verifiëren, dan toont Google de naam van de app; (b) een eigen domein voor Supabase, bijvoorbeeld `auth.bierkoers.nl` (betaalde add-on, vraagt het Pro-abonnement), en dat adres als terugkeer-URL bij Google zetten.
3. **Privacyverklaring nalezen** (`app/privacy.html`). Contact is `proost@bierkoers.nl`, zonder naam. De AVG vraagt wie verantwoordelijk is; zet je naam (en eventueel woonplaats) erbij als je dat goed vindt.
4. **Testen op een echte iPhone en Android.** E-mail koppelen met een echte code, inloggen op een tweede toestel, bevestigen, een foto (ook HEIC op Android) toevoegen en verwijderen, een prijs vervangen ("Is de prijs gewijzigd? Geef de nieuwe prijs door": de oude melding staat dan als "vervangen" in de geschiedenis), en onder Ik een bericht sturen ("Vraag, idee of probleem"): de mail moet in `proost@bierkoers.nl` staan en Beantwoorden moet naar de speler gaan. Het anonieme pad (zonder account melden, de bewaarcookie, dezelfde speler terug na het wissen van de opslag) is al getest.
5. **Inlogcode naar iCloud en Outlook.** Bij Gmail komt de code in de inbox; kijk of dat bij iCloud en Outlook ook zo is. Na een paar weken zonder problemen kan DMARC van `p=none` naar `p=quarantine`; zeg het, dan doet een sessie het via de API van Cloudflare.
6. **Gent inladen.** Vraag onder Ik, Nieuwe stad aanvragen, Gent aan (kies "Gent, Oost-Vlaanderen" uit de lijst) en tik onder Beheer, Stadsaanvragen op Goedkeuren. Je telefoon haalt de kroegen dan zelf bij OpenStreetMap op (de knop toont "Kroegen ophalen…" en daarna "Opslaan…"); houd de app zo lang open. Gent geeft ongeveer 367 kroegen, waarvan 30 cafés, en de 25 stadswijken van Stad Gent.
7. **Twijfelgevallen in de kroegenlijst:** Strik Bakkers Cafe (lijkt een ijssalon), Café Royal en café Billabong (bestaan mogelijk niet meer). Kijk als je er langskomt, of meld ze in de app met "Klopt deze kroeg niet?".

## Onderhoud

1. **DNSSEC bij Vimexx.** In Cloudflare staat DNSSEC aan (status `pending`). Zet bij Vimexx deze DS-record (of de DNSKEY, als Vimexx daarom vraagt):
   - DS: key tag `2371`, algoritme `13`, digest type `2`, digest `756FAC1A9AFE0B23E2BA88CC76B93EB253ED043D03CEE54B24E916E20BA90CC2`
   - DNSKEY: flags `257`, protocol `3`, algoritme `13`, publieke sleutel `mdsswUyr3DPW132mOi8V9xESWE8jTo0dxCjjnopKl+GqJxpVXckHAeF+KkxLbxILfDLUT0rAK9iUzy1L53eKGQ==`

   Zolang de DS-record er niet staat, werkt alles gewoon. Daarna wordt de status in Cloudflare vanzelf `active`.
2. **Edge Functions `eenmalig-migratie` en `eenmalig-import` verwijderen** (Supabase, Edge Functions, Delete). Ze doen niets meer (410); de connector kan geen Edge Function verwijderen.
3. **Apparaatwachtwoord "Meldingen" vernieuwen** (aanbevolen): nieuw apparaat bij de mailbox `proost@bierkoers.nl` in Infomaniak, het oude intrekken en het secret `SMTP_WACHTWOORD` opnieuw zetten (Supabase, Edge Functions, Secrets).
4. **Apple en Google:** bij inloggen met Apple en Google ook het domein `bierkoers.nl` toevoegen.
5. **GitHub:** de oude werkbranches die al in `main` zitten verwijderen, en onder Settings, General **Automatically delete head branches** aanvinken.
6. **Oud HEIC-bestand** (optioneel): Storage, bucket `prijslijsten`, map `649b7305-...`, het `.heic`-bestand. Niemand ziet het meer.

## Inloggen met Apple

De knop staat op slot tot Apple in Supabase aanstaat. Lidmaatschap van het Apple Developer Program, een Services ID en sleutel, de geheime sleutel in Supabase en Apple aanzetten. De geheime sleutel verloopt na hoogstens 6 maanden. Stappenplan: `docs/inloggen-met-apple-en-google.md`.

## Zo doe je het

- **Een ongepaste foto van een ander verwijderen** (spelers verwijderen alleen hun eigen foto). In de SQL Editor; de punten gaan er ook af. Verwijder daarna het bestand in Storage (bucket `prijslijsten`) via het pad uit de eerste query:
  ```sql
  select id, pad, door_id from public.kroeg_fotos where verwijderd_op is null order by op desc;
  update public.kroeg_fotos set verwijderd_op = now() where id = 123;
  delete from public.punten where kaartfoto_id = 123;
  ```
- **Menukaartprijzen met de lokale modellen.** Een sessie op je eigen pc draait `node menufotos.mjs --kroegen google-kroegen-nijmegen.json --sinds 2024-11-01` in `tools/google-kroegen`. Jij zorgt dat de pc aan staat en de server van LM Studio draait (poort 1235). Importeren gaat met `--naar-supabase` en `SUPABASE_URL` en `SUPABASE_SERVICE_ROLE_KEY`, die je zelf in je terminal zet, nooit in Git of in de chat. Werkwijze: `docs/menukaartprijzen.md`.
- **Nakijken van menukaartprijzen** na een run: de subagent menukaart-controleur kijkt de map `nakijken/<datum>` na, daarna `node verwerk-oordelen.mjs nakijken/<datum>` (rapport) en `node verwerk-oordelen.mjs nakijken/<datum> --naar-supabase` (import, met de sleutel alleen in je eigen terminal).
- **Testset voor de menukaartpijplijn** (`tools/google-kroegen/testset/`): een sessie op je pc maakt hem af; jij controleert de labels.
- **Categorie Menu in Google Maps uitzoeken:** met de hand in Chrome, zie `docs/menukaartprijzen.md` (Onderzoek: alleen de categorie Menu ophalen). Een cloudsessie kan dit niet.

## Later

- **Captcha.** Supabase raadt een captcha aan bij anonieme accounts (Cloudflare Turnstile). Zet die pas aan in Supabase als de app hem meestuurt; anders werken beginnen en inloggen niet meer.
- **Opruimen.** Supabase ruimt oude anonieme accounts niet zelf op. Een anoniem account ontstaat pas bij de eerste bijdrage, dus lege accounts zijn zeldzaam. Later kan een taak anonieme accounts zonder punten en check-ins na bijvoorbeeld 30 dagen verwijderen.

## Zo staat het ingesteld

Stand van 22 november 2026.

- **Domein:** `bierkoers.nl` geregistreerd bij Vimexx, DNS bij Cloudflare (nameservers `jocelyn.ns.cloudflare.com` en `kip.ns.cloudflare.com`): DNS-records wijzig je in Cloudflare, niet bij Vimexx. `www.bierkoers.nl` stuurt met een 301 door naar `bierkoers.nl` (Redirect Rule, pad en query blijven staan). De app draait op Cloudflare Pages.
- **Mail:** Infomaniak (kSuite), adres `proost@bierkoers.nl`. In Cloudflare: MX `mta-gw.infomaniak.ch` (prioriteit 5), SPF `v=spf1 include:spf.infomaniak.ch -all`, DKIM op `20261107._domainkey`, DMARC `v=DMARC1; p=none; rua=mailto:proost@bierkoers.nl`.
- **Supabase Auth:** anonieme accounts en manual linking aan, Google aan, Apple uit. Eigen SMTP: afzender `proost@bierkoers.nl` (naam `Bierkoers`), host `mail.infomaniak.com`, poort `465`, met een apparaatwachtwoord van Infomaniak (apparaat "Supabase Bierkoers"). Templates **Magic link or OTP**, **Confirm sign up** en **Change email address**: onderwerp `Je code voor Bierkoers`, tekst uit `supabase/templates/inlogcode.html`. Rate limits: 30 mails per uur en 30 anonieme accounts per uur per IP-adres. Site URL `https://bierkoers.nl`; Redirect URLs `https://bierkoers.nl/**`, `https://www.bierkoers.nl/**`, `https://bpdb-nl.pages.dev/**` en `http://localhost:8765/**`.
- **Edge Functions:** `osm-import`, `account-verwijderen`, `samenvoegen` en `melding-mail` (verify_jwt aan). Secret `SMTP_WACHTWOORD` (apparaat "Meldingen"); optioneel `MELDING_NAAR`, `SMTP_GEBRUIKER` en `SMTP_HOST`, anders `proost@bierkoers.nl` en `mail.infomaniak.com`.
- **Security Advisor:** alleen bekende, bewuste waarschuwingen: anonieme spelers lezen en wissen hun eigen check-ins, naam en foto's en lezen hun eigen berichten met de antwoorden (`bugmeldingen`, `bericht_antwoorden`); leesregels die alleen voor beheerders gelden (`stadsaanvragen`, `kroeg_voorstellen`); `rls_policy_always_true` op `kaartscans` (iedereen mag een scan toevoegen, niemand mag lezen, wijzigen of wissen); en gelekte wachtwoorden (Bierkoers gebruikt geen wachtwoorden).
- **Claude-omgeving:** een API-token van Cloudflare als netwerkgeheim (zone `bierkoers.nl`: Zone Read, DNS Edit, Single Redirect Edit, Zone Settings Edit), zodat een sessie DNS, redirects en DNSSEC zelf doet, en een DeepSeek-sleutel voor `--extern`. Intrekken in Cloudflare (My Profile, API Tokens), bij DeepSeek en in de omgeving van Claude (Settings, network secrets).
