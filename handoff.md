# Overdracht (21 november 2026, eind van de avond)

Voor de volgende sessie. Lees eerst `CLAUDE.md` (werkafspraken; op 21 november flink aangevuld) en `ACTIES.md` (wat Kjell zelf moet doen; bovenaan wat er voor de demo nog openstaat). Alles hieronder is aan het eind van 21 november 2026 gecontroleerd tegen de code, de live site of de database, behalve waar "niet gecontroleerd" staat.

## 1. In het kort

- Al het werk staat op `main` (`cfb5096`, PR #49) en is live op bierkoers.nl. Er staat geen pull request open.
- Nijmegen: **22 van de 161 open kroegen in kaart** (2 bevestigd, 4 spelermeldingen, 16 menukaartprijzen). Pilsindex € 3,90.
- Wat uit bronnen te halen valt, is binnen: eigen websites (DAEN) en foto's in Google Maps (JAN) zijn allebei doorzocht. De rest van de kaart komt van spelers ter plaatse.
- Wat nog openstaat voor de demo, kan alleen Kjell (Cloudflare, Google Cloud, echte telefoons); zie punt 4.

## 2. Repository en tests

- Begin altijd vanaf de nieuwste `main` (`git fetch origin main && git checkout -B <sessiebranch> origin/main`). Standaardbranch op GitHub is `main`.
- `npm run check` slaagt; `npm run test:db`: 324 goed in `database.test.mjs`, 10 in `melding-mail.test.mjs`. De tools: `cd tools/google-kroegen && node --test test/*.test.mjs`, 69 goed (met `jpeg-js` en `tesseract.js` geïnstalleerd, zie punt 7).
- Geen CI behalve de build van Cloudflare Pages; die geeft per pull request een preview.
- Service worker `CACHE`: `bierkoers-v57` (live).

## 3. Wat er op 21 november is gebeurd

Pull requests #47, #48 en #49, alle gemerged.

**App**
- Privacyverklaring `app/privacy.html` (Nederlands en Engels), live op `https://bierkoers.nl/privacy` (Cloudflare stuurt `/privacy.html` daarheen door). Link onderaan Ik (`privacyRegel()` in `app/app.js`). Contact `proost@bierkoers.nl`, zonder naam.
- Deelvoorbeeld voor WhatsApp en iMessage: `og:`-tags, `canonical` en `app/og.png` (1200 x 630).
- `/api/sessie` geeft 204 als er geen bewaarde sessie is (was 404, een fout in de console).
- Privacylek gedicht: `verkleinFoto()` codeert een foto altijd opnieuw. Eerder ging het origineel, met EXIF en dus soms de plek van de foto, naar de openbare bucket als de JPEG niet kleiner werd.

**Database** (project `yzaootlrhxzyxtvacrot`)
- Migratie `20261121220000_samenvoegen_fotos`: `private.voeg_samen` neemt nu ook `kroeg_fotos`, `bugmeldingen` en `stadsaanvragen` mee. Live, versie gezet, beveiligingsadviezen alleen de bekende waarschuwingen.
- 11 menukaartprijzen van eigen websites, elk zelf gelezen en goedgekeurd door de subagent menukaart-controleur (verslag: `docs/menukaartprijzen.md`, "Tweede ronde DAEN").
- Gesloten met `gesloten_door_spelers = true` (zodat een import ze niet heropent): Dreadlock en Kronkel (coffeeshops) en Park Café (droge horeca).
- De kapotte HEIC-foto bij Samson en zijn punten zijn weg; `kroeg_fotos` is leeg. Het bestand staat nog in de bucket.

**Menukaartpijplijn** (`tools/google-kroegen/`)
- "Vaas" telt als vaasje (`kiesVaasje()`, de controleur en de documentatie). De Ruyter is daarna alsnog geïmporteerd.
- De fotomethode (JAN) is vanuit de cloud gedraaid met DeepSeek over 49 kroegen zonder prijs: geen CAPTCHA, ongeveer $ 0,03, maar geen bruikbare prijs. De enige treffer was een actieprijs bij De Tempelier ("Knaken dinsdag", Heineken € 2,50), afgekeurd. Twee gaten gedicht, met tests: de mediaancontrole telt nu ook menukaartprijzen (`per25VoorMediaan()` in `bron/controles.mjs`; stond uit met maar 2 bevestigde prijzen), en de lezer markeert actieprijzen (veld `actie`) die `kiesVaasje()` overslaat.

**Getest op de live site**
- Het anonieme pad in een iPhone-browser: zonder account een prijs melden (anonieme speler, +50), de bewaarcookie, en na het wissen van de browseropslag dezelfde speler terug via `/api/sessie`. Geen fouten. De testgegevens zijn verwijderd. Na het wissen toont de app de uitleg opnieuw (die keuze staat in `localStorage`); onschuldig.

**Afspraken** (in `CLAUDE.md`)
- Migraties en andere databasewijzigingen zonder akkoord vooraf; spelregels alleen op verzoek.
- DeepSeek (`--extern`) mag vanuit een cloudsessie.
- Zelfstandig de grens opzoeken: de regels van het project zijn van Kjell en mogen wijken als ze het resultaat in de weg zitten (zeg het erbij). Een CAPTCHA van Google los je nooit op en omzeil je niet: dat is een beveiliging van Google, geen regel van Kjell.

## 4. Stand van productie (gecontroleerd)

| | |
|---|---|
| Kroegen Nijmegen | 161 open; 22 in kaart; Pilsindex € 3,90 |
| Accounts | 4, alle met e-mailadres; 0 anoniem; 9 check-ins; 2 Guinness-prijzen; 0 bugs; 0 stadsaanvragen |
| Laatste migratie | `20261121220000_samenvoegen_fotos` |
| Auth | anonieme accounts aan, Google aan, Apple uit |
| DMARC | ontbreekt (`_dmarc.bierkoers.nl` bestaat niet) |
| www.bierkoers.nl | 200, een tweede kopie in plaats van een doorverwijzing |
| DNSSEC | uit (geen DS-record bij .nl) |
| Edge Function `eenmalig-migratie` | leeg, geeft 401/410; mag in het dashboard weg |
| DeepSeek-saldo | $ 1,99 |

Nog open voor de demo, alleen door Kjell (op volgorde in `ACTIES.md`): DMARC toevoegen in Cloudflare, Google-inlog op "In production" met `https://bierkoers.nl/privacy` als privacy-URL, www laten doorsturen, de privacyverklaring nalezen (naam erbij of niet), en op een echte iPhone en Android e-mail koppelen, inloggen op een tweede toestel, bevestigen en een foto (ook HEIC op Android) toevoegen en verwijderen.

Niet gecontroleerd: of de Google-app op "In production" staat, het Supabase-abonnement, back-ups en automatisch pauzeren, Safari op een echte iPhone.

## 5. Zorgen en open beslissingen

- **Twijfelgevallen in de kroegenlijst**: Strik Bakkers Cafe (lijkt een ijssalon), Café Royal en café Billabong (bestaan mogelijk niet meer). Niet gesloten zonder bewijs.
- **Punten voor foto's**: 5 per kroeg per speler, zonder beoordeling; de bucket is openbaar en er is geen moderatie behalve de SQL in `ACTIES.md`.
- **Vervangen**: twee e-mailaccounts kunnen elkaars melding vervangen voor +30, begrensd op 5 per speler per dag.
- **Een eigen melding vervangen** (typefout) kan niet; niet gebouwd zonder akkoord.
- Het Infomaniak-apparaatwachtwoord stond in een chat; rotatie aanbevolen (`ACTIES.md`).

## 6. Werkwijze voor menukaartprijzen (zoals op 21 november)

1. **Websites**: `osm_id` uit de database, tags per 50 via `https://api.openstreetmap.org/api/0.6/nodes.json?nodes=...` (Overpass geeft vanuit de cloud een time-out). Daarna crawlen op links met menu, kaart, drank, bier, tap of pdf; pdf's met `pdftotext -layout`; WordPress-datums via `/wp-json/wp/v2/media` en `/wp-json/wp/v2/pages`; sites met JavaScript nog een keer met Playwright. Kroegen zonder website in OSM: Haiku-agents laten zoeken, met weinig opbrengst.
2. **Foto's in Google Maps**: `node menufotos.mjs --kroegen <bestand> --extern --sinds 2024-11-01 --max-fotos 150` vanuit `tools/google-kroegen` (zie punt 7 voor de omgeving). Een kroeg tegelijk, 3 seconden pauze; bij een CAPTCHA stopt de run.
3. **Lezen en nakijken**: elke prijs zelf op de kaart lezen (pdf-pagina als afbeelding met `pdftoppm`), een geval maken in `tools/google-kroegen/nakijken/<datum>/<id>-<naam>/` met `geval.json`, `uitsnede.jpg` en `foto.jpg`, en de subagent menukaart-controleur per geval laten oordelen.
4. **Regels**: alleen de goedkoopste pils van de tap in 25 cl, of het woord "vaasje" of "vaas"; geen actieprijs; een datum van de kaart zelf (pdf ModDate, wijzigingsdatum van de pagina, sitemap `lastmod`, of een vaste `Last-Modified`), nooit de dag van kijken; is er een nieuwere kaart die je niet kunt lezen, dan geen prijs. Daarna de vaste controles (€ 2,00 tot € 7,50, hoogstens 30% van de mediaan) en importeren met `select public.importeer_menuprijzen('<json>'::jsonb)` via `execute_sql`.

Wat nog kan: eigen websites periodiek opnieuw doorzoeken (kaarten veranderen; deze keer vielen er zes af omdat de maat van het kleine glas ontbrak), en de fotomethode opnieuw draaien als er nieuwe foto's zijn.

## 7. Valkuilen in de cloudsessie

- **Supabase-MCP**: lezen en gewone `insert`, `update` en `delete` gaan zonder vraag. DDL (`apply_migration`, of `create function` in `execute_sql`) vraagt altijd om bevestiging in de Claude-app, ook met "Altijd toestaan"; zonder antwoord loopt de aanroep na 60 seconden vast. Kjell wil niet gevraagd worden. Werkwijze voor DDL:
  1. `deploy_edge_function` met naam `eenmalig-migratie` en `verify_jwt: false`. De code importeert `npm:postgres@3.4.4`, verbindt met `Deno.env.get("SUPABASE_DB_URL")` en voert met `sql.unsafe()` alleen de vaste tekst van de migratie uit, plus de regel die de versie in `schema_migrations` zet en een controlequery. Hij draait alleen met een header `x-eenmalig` met een willekeurige sleutel (`openssl rand -hex 24`), anders 403.
  2. Aanroepen met `curl -X POST -H "x-eenmalig: <sleutel>" https://yzaootlrhxzyxtvacrot.supabase.co/functions/v1/eenmalig-migratie` en de controle lezen.
  3. Direct een lege versie uitrollen (`verify_jwt: true`, altijd 410), de sleutel weggooien, en de beveiligingsadviezen draaien. Een Edge Function verwijderen kan niet via MCP.
- **Fotomethode met DeepSeek**: draai met `NODE_USE_ENV_PROXY=1` (anders gaat Node buiten de proxy om en krijgt DeepSeek geen sleutel: HTTP 401). Installeer in `tools/google-kroegen` alleen `npm install --no-save --no-package-lock jpeg-js@0.4.4 tesseract.js@6.0.1`, en maak `node_modules/playwright` en `node_modules/playwright-core` koppelingen naar `/opt/node-tools/node_modules/...`; de vastgepinde Playwright 1.48 vindt de vooraf geïnstalleerde browser niet. `node_modules` staat niet in Git.
- **Browser**: Playwright en Chromium staan klaar. Test de app met `python3 -m http.server 8765 --directory app` op telefoonbreedte; lokaal geeft `POST /api/sessie` een 501 (de Python-server kent geen POST), geen fout van de app. Bootst schrijfacties na met `page.route`, of ruim testdata in productie direct op (zoals bij de test van het anonieme pad). In de app sluit je de uitleg met `#intro button` en open je een kroeg via het zoekveld `input[data-zoek]`.
- **Lange taken**: gebruik `run_in_background` en volg met een Monitor; een sessie kan halverwege herstarten. Push daarom tussendoor.
- **Mergen** alleen als Kjell erom vraagt; hij merget zelf snel.
- Scripts van 21 november (crawler, Playwright-ronde, deelplaatje, test van het anonieme pad) stonden in de scratchpad en zijn weg; schrijf ze opnieuw als je ze nodig hebt.

## 8. Aanbevolen volgende stappen

1. Na de demo vragen wat er misging op echte telefoons, en dat oplossen.
2. Als Kjell DMARC, Google-inlog en www heeft gedaan: live controleren (`_dmarc` via DNS, `www` geeft een 301, inloggen met Google buiten de testgebruikers) en `ACTIES.md` afvinken.
3. De twijfelgevallen in de kroegenlijst nagaan zodra er meldingen of check-ins zijn.
4. Over een paar maanden de eigen websites (DAEN) opnieuw doorzoeken op nieuwe drankkaarten.
