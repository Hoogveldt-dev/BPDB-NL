# Overdracht (21 november 2026, avond)

Voor de volgende sessie. Lees eerst `CLAUDE.md` (werkafspraken) en `ACTIES.md` (wat Kjell zelf moet doen; bovenaan staat wat er voor de demo nog moet). Dit document vervangt de handoff van eerder vandaag (branch `ccr-02367abf-oyg1ji`): die had een paar fouten en miste een paar dingen, zie punt 6. Alles hieronder is op 21 november 2026 gecontroleerd tegen de code, de live site of de database, behalve waar "niet gecontroleerd" staat.

## 1. Repository

- Het werk van deze avond is gemerged in PR #47 (`main` op `4c7eb12`) en staat live: `/privacy`, `og.png` en 204 op `/api/sessie` zijn op bierkoers.nl gecontroleerd. Begin een nieuwe taak vanaf de nieuwste `main`.
- Standaardbranch op GitHub is `main` (gecontroleerd met `git ls-remote --symref origin HEAD`).
- Tests: `npm run check` en `npm run test:db` (324 goed in `database.test.mjs`, 10 in `melding-mail.test.mjs`). Geen CI behalve de build van Cloudflare Pages.
- Service worker `CACHE`: `bierkoers-v57` (live gecontroleerd).

## 2. Wat deze avond is gedaan

In de pull request:

- **Privacyverklaring** `app/privacy.html` (Nederlands en Engels), link onderaan Ik in alle varianten van dat scherm (`privacyRegel()` in `app/app.js`). Google vraagt deze link voor inloggen met Google. Contact `proost@bierkoers.nl`, zonder naam: Kjell beslist of zijn naam erbij komt.
- **Deelvoorbeeld**: `og:`-tags, `canonical` en `app/og.png` (1200 x 630, logo en woordmerk op inkt) in `app/index.html`.
- **`/api/sessie`** geeft 204 in plaats van 404 als er geen bewaarde sessie is (`app/_worker.js`); `bewaar.herstel()` kijkt nu naar status 200.
- **Privacylek gedicht**: `verkleinFoto()` uploadde het origineel als de JPEG niet kleiner werd, met de EXIF-gegevens (zoals de plek van de foto) naar de openbare bucket `prijslijsten`. Nu codeert hij altijd opnieuw.
- **Samenvoegen** (`supabase/migrations/20261121220000_samenvoegen_fotos.sql`): `private.voeg_samen` verhuist nu ook `kroeg_fotos`, `bugmeldingen` en `stadsaanvragen`. Zonder dit kon een speler na het samenvoegen zijn eigen foto niet verwijderen (de punten gingen wel mee). Een foto bij een kroeg waar het account al een foto had, verliest zijn 5 punten (hoogstens 5 per kroeg per speler, zoals de spelregel al zei). Test erbij; de test faalt zonder de migratie. **De migratie staat nog niet op Supabase** (ACTIES.md, demo-stap 2).

Rechtstreeks in de database (project `yzaootlrhxzyxtvacrot`), via `importeer_menuprijzen`:

- **10 menukaartprijzen** van de websites van kroegen (DAEN), elk zelf gelezen op de kaart en goedgekeurd door de subagent menukaart-controleur. Nijmegen ging van 11 naar **21 van de 164 open kroegen in kaart** (2 bevestigd, 4 spelermeldingen, 15 menukaartprijzen). Werkwijze, afvallers en redenen: `docs/menukaartprijzen.md`, "Tweede ronde DAEN vanuit een cloudsessie". Een menukaartprijs is blauw tot een speler ter plaatse "Klopt" zegt.

## 3. Stand van productie (gecontroleerd)

- `kroeg_kaart`, Nijmegen, open: 164 kroegen; 21 in kaart (`inKaart()` in `app/app.js`: bevestigd, menukaart of wachtend). Mediaan voor de Pilsindex € 3,90.
- 4 accounts, alle met e-mailadres; 0 anonieme accounts. Het anonieme pad is dus nooit door een echte speler gelopen.
- Migraties op Supabase: tot en met `20261121200000_kaartfotos_punten_verwijderen`, allemaal met de versie gelijk aan de bestandsnaam (ook `20261113180000_punten_meteen`, die in ACTIES.md nog als open stond).
- `kroeg_fotos` id 1 (HEIC bij Samson) staat er nog en toont kapot.
- DNS: SPF en DKIM zijn er, **DMARC niet** (`_dmarc.bierkoers.nl` bestaat niet). Geen DS-record bij .nl, dus DNSSEC staat uit.
- `www.bierkoers.nl` geeft een tweede kopie van de app (200) in plaats van door te sturen.
- Auth-instellingen: anonieme accounts aan, Google aan, Apple uit. Of de Google-app op "In production" staat, is niet te zien vanuit de cloud (niet gecontroleerd).

## 4. Klaar voor een demo aan vrienden?

Bijna. Wat nog moet, staat op volgorde in `ACTIES.md` onder "Eerst: voor de demo". Het belangrijkste: de pull request mergen, DMARC toevoegen (anders kan de inlogcode in de spam), Google op "In production" (anders kunnen vrienden niet met Google inloggen) en een keer op een echte iPhone en Android het hele anonieme pad lopen.

Met 21 van de 164 kroegen in kaart is de kaart nog grotendeels grijs. Presenteer het als "we spelen vanavond de stad vrij": de 13 menukaartprijzen in het centrum zijn ideaal om ter plaatse met "Klopt" te bevestigen, en dat levert punten op.

## 5. Zorgen en open beslissingen voor Kjell

- **"Vaas" telt niet als vaasje** volgens de controleur (De Ruyter, Grolsch vaas € 3,50 afgekeurd), maar bij Café Faber en Brouwerij Florijn telde een eerdere sessie "vaas" wel. Ongelijk; Kjell beslist. Advies: "vaas" telt als vaasje, dat is in Nederlandse kroegen hetzelfde glas.
- **De kroegenlijst bevat zaken die geen kroeg zijn**: Dreadlock en Kronkel (coffeeshops), Park Café (droge horeca), Strik Bakkers Cafe (ijssalon); Café Royal en café Billabong bestaan mogelijk niet meer. Alleen Park Café staat in ACTIES.md met SQL; voor de rest eerst nagaan. Ze maken de voortgang kleiner dan hij is.
- **Punten voor foto's zijn te farmen tot een grens**: 5 per kroeg per speler, zonder beoordeling. De bucket `prijslijsten` is openbaar en er is geen moderatie behalve de SQL in ACTIES.md.
- **Vervangen**: twee e-mailaccounts kunnen elkaars melding vervangen voor +30, begrensd op 5 per speler per dag.
- **Een eigen melding vervangen** (typefout) kan niet; niet gebouwd zonder akkoord.
- Het Infomaniak-apparaatwachtwoord stond in een chat; rotatie aanbevolen (stappen in ACTIES.md).
- Niet gecontroleerd: Supabase-abonnement, back-ups en automatisch pauzeren, het Google-dashboard, Safari op een echte iPhone.

## 6. Correcties op de vorige handoff

- "Samenvoegen verhuist `gebeurtenissen.vervangen_door` niet": klopt, maar dat is geen probleem. Een anonieme speler kan geen melding vervangen (`private.meld_prijs`), en samenvoegen gaat alleen van een anonieme speler naar een account. Wat wel ontbrak: `bugmeldingen` en `stadsaanvragen` (nu gerepareerd, samen met `kroeg_fotos`).
- "Vul vooraf ruim 20 prijzen in" als taak voor Kjell: een cloudsessie kan dat deels zelf met de DAEN-methode. Dat is deze avond gedaan (+10). Meer kan vanaf de pc van Kjell met de JAN-methode (foto's in Google Maps, `docs/menukaart-manager.md`).
- Gemist: het EXIF-lek in `verkleinFoto()` (zie punt 2).
- Gemist: de standaardbranch stond al op `main` en `punten_meteen` stond al op Supabase; ACTIES.md zei nog van niet. Bijgewerkt.
- De handoff stond alleen op een sessiebranch zonder pull request. Deze staat in de pull request, zodat hij op `main` komt.

## 7. Werkafspraken en valkuilen (naast CLAUDE.md)

- Kjell wil dat je zelfstandig werkt en het maximale resultaat haalt; hij heeft weinig tijd. Bouw wat nodig is, maar wijzig geen spelregels zonder akkoord. Hij gaf toestemming voor Haiku-agents waar dat helpt.
- Mergen alleen als hij erom vraagt. Een PR die je zelf maakt, laat je open.
- **Supabase-MCP**: lezen werkt. Deze avond werkte ook `execute_sql` met `select public.importeer_menuprijzen(...)` zonder bevestigingsvraag. DDL (`apply_migration`) vraagt Kjell om bevestiging; die vraag bereikt hem vaak niet en de aanroep loopt dan na 60 seconden vast. Geef dan de SQL in een tekstblok voor de SQL Editor.
- **Netwerk in de cloud**: Overpass (OSM) geeft een time-out; gebruik `api.openstreetmap.org/api/0.6/nodes.json`. Google Maps geeft al snel een CAPTCHA. Websites van kroegen zijn bereikbaar.
- **Browser**: Playwright en Chromium staan klaar. Draai de app met `python3 -m http.server 8765 --directory app` en test op telefoonbreedte. Bootst schrijfacties na met `page.route`, anders komt er testdata in productie. Lokaal geeft `POST /api/sessie` een 501 (de Python-server kent geen POST); dat is geen fout van de app.
- **Menukaartprijzen**: elke prijs zelf lezen op de kaart (pdf-pagina als afbeelding met `pdftoppm`), dan een geval maken in `tools/google-kroegen/nakijken/<datum>/<id>-<naam>/` met `geval.json`, `uitsnede.jpg` en `foto.jpg`, en de subagent menukaart-controleur per geval laten oordelen. Liever geen prijs dan een verkeerde: zonder maat bij het kleine glas, zonder datum, of met een nieuwere kaart die je niet kunt lezen, geen prijs.
- Testscripts van deze avond stonden in de scratchpad (vluchtig, niet in Git): een crawler voor sites, een Playwright-ronde voor sites met JavaScript, en het deelplaatje (`og.png`, HTML gerenderd met Playwright op 1200 x 630).

## 8. Aanbevolen volgende stappen

1. Na de merge: migratie `20261121220000_samenvoegen_fotos` op Supabase (met akkoord van Kjell), versie gelijkzetten, Security Advisor.
2. Kjells beslissing over "vaas" vragen; is het ja, dan De Ruyter (€ 3,50, kaart van 19 september 2026) alsnog importeren.
3. De kroegen die geen kroeg zijn (punt 5) met Kjell doorlopen en sluiten.
4. Op de pc van Kjell de JAN-methode draaien voor de rest van Nijmegen (`docs/menukaart-manager.md`): de meeste kroegen zonder prijs hebben geen eigen website.
5. Na de demo: vragen wat er misging op echte telefoons, en `ACTIES.md` bijhouden.
