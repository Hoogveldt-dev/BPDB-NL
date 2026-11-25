# Menukaartprijzen: de JAN-methode en de DAEN-methode

Menukaartprijzen vullen de prijsgeschiedenis voordat een speler een kroeg bezoekt. Ze tellen mee in de koers en de Pilsindex, maar zijn geen melding: ze staan niet in "Laatste meldingen" en niet in de activiteit van de lichtkrant. Ze verschijnen met het mist-effect tot een speler ter plaatse "Klopt, ik ben er" zegt; die speler wordt indiener, en daarna gelden de gewone regels (bevestiging door een andere speler). Invoer gaat altijd via `importeer_menuprijzen` (alleen `service_role`), met kroeg, merk, volume, prijs, datum en een omschrijving van de bron.

Het spel gebruikt alleen de goedkoopste pils van de tap in een vaasje (25 cl). Andere maten en bieren laten we voor nu liggen.

## Werkwijze in het kort

Stand van 21 november 2026.

1. **Eigen websites (DAEN).** `osm_id` uit de database, tags per 50 via `https://api.openstreetmap.org/api/0.6/nodes.json?nodes=...` (Overpass geeft vanuit de cloud een time-out). Daarna crawlen op links met menu, kaart, drank, bier, tap of pdf; pdf's met `pdftotext -layout`; WordPress-datums via `/wp-json/wp/v2/media` en `/wp-json/wp/v2/pages`; sites met JavaScript nog een keer met Playwright. Kroegen zonder website in OSM: agents laten zoeken, met weinig opbrengst.
2. **Foto's in Google Maps (JAN).** `node menufotos.mjs --kroegen <bestand> --extern --sinds 2024-11-01 --max-fotos 150` vanuit `tools/google-kroegen`. Een kroeg tegelijk, 3 seconden pauze; bij een CAPTCHA stopt de run.
3. **Lezen en nakijken.** Elke prijs zelf op de kaart lezen (pdf-pagina als afbeelding met `pdftoppm`), een geval maken in `tools/google-kroegen/nakijken/<datum>/<id>-<naam>/` met `geval.json`, `uitsnede.jpg` en `foto.jpg`, en elk geval laten nakijken met `NODE_USE_ENV_PROXY=1 node deepseek-controleur.mjs nakijken/<datum>` (DeepSeek met dezelfde opdracht als de subagent menukaart-controleur; schrijft per geval `oordeel.json`). De Haiku-subagent alleen als DeepSeek niet beschikbaar is: Claude-gebruik is schaars. Elke prijs wordt nagekeken, niet alleen een steekproef. Afgekeurd omdat de bron onduidelijk was: verbeter alleen de bron (nooit de prijs) en laat opnieuw beoordelen.
4. **Regels.** Alleen de goedkoopste pils van de tap in 25 cl, of het woord "vaasje" of "vaas"; in België ook een pils van het vat zonder maat als de prijs binnen 15% van de Pilsindex van de stad ligt (daar is het kleine glas het pintje van 25 cl; spelers corrigeren het als het niet klopt); geen actieprijs; een datum van de kaart zelf (pdf ModDate, wijzigingsdatum van de pagina, sitemap `lastmod`, of een vaste `Last-Modified`), nooit de dag van kijken; is er een nieuwere kaart die je niet kunt lezen, dan geen prijs. Daarna de vaste controles (€ 2,00 tot € 7,50, hoogstens 30% van de mediaan) en importeren met `select public.importeer_menuprijzen('<json>'::jsonb)` via `execute_sql`. Liever geen prijs dan een verkeerde.
5. **Verslag.** Zet onderaan dit document wat er is gedaan en gevonden.

Wat nog kan: eigen websites periodiek opnieuw doorzoeken (kaarten veranderen; op 21 november vielen er zes af omdat de maat van het kleine glas ontbrak), en de fotomethode opnieuw draaien als er nieuwe foto's zijn.

## DAEN-methode: de drankkaart van de eigen website

Genoemd naar Café Daen (6 november 2026: Hertog Jan 25 cl €4,00, drankkaart van 2 september 2026).

1. Zoek de website van de kroeg (staat in Google Maps of OSM).
2. Zoek de drankkaart: een link naar een pdf op de menupagina, of in de openbare mediabibliotheek van WordPress (`/wp-json/wp/v2/media?search=drank`).
3. Is de pdf opgemaakt met tekst, dan volstaat `pdftotext -layout`; geen AI nodig. Alleen een gescande pdf of een afbeelding gaat naar een vision-model: op de pc eerst een lokaal model in LM Studio (Qwen3.5). Draait de pc niet, dan leest Claude de kaart zelf, en de betaalde DeepSeek-sleutel alleen als het echt moet.
4. Datum: het moment waarop de kaart gemaakt of voor het laatst gewijzigd is, nooit de dag dat wij kijken. In deze volgorde:
   1. EXIF-datum van een foto of afbeelding (`DateTimeOriginal`, zoals bij de JAN-methode);
   2. een datum op de kaart zelf of in de bestandsnaam;
   3. de wijzigingsdatum van de pagina of het bestand: bij WordPress `modified` uit `/wp-json/wp/v2/pages?slug=<pagina>` of `/wp-json/wp/v2/media`, anders `dateModified` of `article:modified_time` in de HTML, bij Webflow `Last Published` in de broncode;
   4. de map in de URL (`uploads/2026/09/`) of `Last-Modified` van de server, alleen als die niet bij elk verzoek de huidige tijd geeft.
   Vind je geen van deze, dan geen prijs.

Voordelen: de bron is de kroeg zelf, het is goedkoop en het mag. Nadeel: veel kroegen zetten alleen hun eetkaart online.

## JAN-methode: foto's van de kaart in Google Maps

Genoemd naar Stadscafé Jan (vaasje €3,90 op 20 december 2025, van een menufoto). Sinds 6 november 2026 automatisch met `tools/google-kroegen/menufotos.mjs`:

1. **Fotolijst.** De tool opent de kroeg in Google Maps in een browser en vraagt vanuit die pagina de fotolijst op (de RPC `hspqX`, die Google Maps zelf gebruikt). Per foto: ID, soort, adres van de afbeelding en uploaddatum. 10 foto's per verzoek, met pauzes.
2. **Goedkope filters (zonder model).** Bijna gelijke foto's binnen een kroeg (dHash) slaan we over; de nieuwste blijft. OCR zoekt bedragen: foto's met een bedrag gaan eerst, de rest pas als die niets opleveren (`--ocr filter` gooit ze weg, `--zonder-ocr` zet het uit). Zie `tools/google-kroegen/README.md`.
3. **Schiften (ruim, goedkoop).** Per 20 foto's, nieuwste upload eerst, een contactblad: miniaturen van 240 px met een nummer in een afbeelding. Het model noemt zonder na te denken de nummers waarop een kaart of krijtbord te zien is.
4. **Controleren (streng, goedkoop).** Elke kandidaat apart op 768 px, zonder nadenken: staan er bierprijzen op die je kunt lezen? QR-bordjes, eten en sfeerfoto's vallen hier af.
5. **Datum.** Van wat overblijft haalt de tool het origineel (`=s0`). Google laat daarin de EXIF-gegevens van de maker staan: `DateTimeOriginal` is het moment van de foto. Zonder EXIF telt de uploaddatum. Ligt de EXIF-datum na de upload of in de toekomst, dan stond de klok van de camera verkeerd en telt de uploaddatum. Een foto ouder dan tien jaar houden we, met een markering in de omschrijving.
6. **Lezen (duur, alleen als het moet).** Een leesbare versie (1600 px) gaat naar het model, nu met nadenken (zonder leest het slordig: in de proef werd €3,50 dan €2,30). `kiesVaasje` kiest de goedkoopste pils van de tap in 25 cl; zonder maat alleen bij het woord "vaasje" of "vaas" (sinds 21 november 2026: op Nederlandse kaarten is een vaas hetzelfde glas, naast de kleinere fluit). Twijfel ("medium") = geen prijs. Een prijs buiten € 2,00 tot € 7,50, of meer dan 30% van de mediaan van de stad af, gaat naar `twijfels`.
7. **Stoppen.** Levert een groep een vaasjesprijs op, dan kijken we niet verder naar oudere foto's.
8. **Nieuwste kaart wint.** Per kroeg de prijs met de nieuwste datum, als rij voor `importeer_menuprijzen`.

Model: standaard lokaal (sinds 10 november 2026). Qwen3.5 en Gemma 4 draaien in LM Studio op de eigen pc, zonder kosten of limiet, met een tweede mening per prijs en elke foto apart geschift in plaats van op een contactblad: zie `docs/lokale-vision.md`. Alleen als reserve, als het echt moet: `--extern` gebruikt de betaalde DeepSeek (`deepseek-flash`, via `DEEPSEEK_API_KEY`) of een ander model in het OpenAI-formaat via `MENU_MODEL_URL` en `MENU_MODEL`. Let op: automatisch foto's bij Google ophalen werkt alleen vanaf een thuisverbinding, dus zonder de pc lukt deze methode ook met DeepSeek niet. (Het zijn de foto's van het bedrijfsprofiel, dezelfde als in Google Zoeken; de tool haalt de lijst via een Maps-pagina op omdat dat daar kan.) Een foto die je zelf vindt, kan Claude of DeepSeek wel altijd lezen.

### Nakijken: Claude kijkt alleen waar het nodig is

De lezer geeft bij elke prijs ook aan waar de regel op de foto staat (`vak`) en waar de kop van de bierlijst staat (`kop`), als fractie van de foto. Na een run schrijft `menufotos.mjs` naar `nakijken/<datum>/` (niet in Git):

- alle `twijfels`: de modellen waren het oneens, of een vaste controle keurde de prijs af;
- een willekeurige steekproef van 10% van de prijzen waar beide modellen het eens waren (`--steekproef 0.1`, `0` voor geen). Zo meten we hoe vaak ze samen fout zitten.

Per geval een map met `uitsnede.jpg` (de prijsregel over de hele breedte, met marge en de kop erboven), `foto.jpg` (de hele foto op 1024 px) en `geval.json` (gelezen prijs, oordeel van lezer en kijker, reden). `rijen.json` bevat de prijzen waar beide modellen het eens waren.

Daarna nakijken met DeepSeek: `node deepseek-controleur.mjs nakijken/<datum>` (in een cloudsessie met `NODE_USE_ENV_PROXY=1`). Het script stuurt per geval dezelfde opdracht als de subagent hieronder, met `geval.json`, de uitsnede en de foto, naar DeepSeek en schrijft `oordeel.json`. Op 25 november 2026 gaf het bij alle 11 Gentse gevallen hetzelfde oordeel als de subagent en keurde het twee nagemaakte fouten af (verkeerde prijs, een tripel in plaats van pils). Alleen als DeepSeek niet beschikbaar is, met de subagent in Claude Code:

1. Vraag: "Kijk `tools/google-kroegen/nakijken/<datum>` na met de menukaart-controleur en zet elk antwoord als `oordeel.json` in de map van het geval." De subagent `.claude/agents/menukaart-controleur.md` draait op Haiku, mag alleen lezen, bekijkt eerst de uitsnede en alleen bij twijfel de hele foto, en antwoordt met `{"is_menukaart", "prijs_klopt", "juiste_prijs", "toelichting"}`.
2. `node verwerk-oordelen.mjs nakijken/<datum>` maakt `nakijken/<datum>/nagekeken.json`: goedgekeurde twijfels erbij, afgekeurde steekproefprijzen eraf, en een rapport met hoe vaak de modellen samen fout zaten. Een andere prijs van de controleur (`juiste_prijs`) importeren we niet: liever geen prijs dan een verkeerde.
3. De beheerder bekijkt het rapport en importeert zelf met `node verwerk-oordelen.mjs nakijken/<datum> --naar-supabase`.

### Wat het kost

Gemeten op 6 november 2026 met dezelfde foto's:

| Kroeg | Eerste versie (groepjes van 10 losse foto's, steeds nadenken) | Nu (contactblad en controle zonder nadenken) |
|---|---|---|
| Café Van Buren, 17 foto's, geen kaart met prijzen | ongeveer 7.300 tokens in, 4.900 uit | 1.734 in, 29 uit |
| St Anneke, 10 foto's, een krijtbord | 4.037 in, 5.400 uit | 2.322 in, 4.237 uit (bijna alles is het lezen van het krijtbord) |

Wat overblijft is het lezen van echte kaarten, en dat gebeurt nu alleen bij foto's met bierprijzen. Alle proeven van die dag samen kostten ongeveer $0,02 aan DeepSeek.

Een foto van een speler werkt hetzelfde: datum uit EXIF, prijs met het model.

### Spelregels voor Google

- Automatisch uitlezen van Google Maps is in strijd met de gebruiksvoorwaarden van Google (zie `docs/google-maps-bronnen.md`). We doen het met mate: een kroeg tegelijk, ongeveer 3 seconden tussen verzoeken, een run per paar maanden.
- Google stuurt bij te veel verzoeken naar een CAPTCHA. Dan stopt de run meteen en bewaart wat al gevonden is. De CAPTCHA lossen we niet op en we proberen niet opnieuw.
- Vanaf een datacenter (zoals een cloudsessie) volgde die CAPTCHA op 6 november al na een paar kroegen. Op 21 november 2026 liep een cloudsessie 49 kroegen zonder CAPTCHA (zie hieronder). Komt er een, dan stopt de run; we lossen hem niet op en omzeilen hem niet.
- We bewaren alleen prijs en datum, niet de foto of de naam van de maker.

## Onderzoek: alleen de categorie Menu ophalen

Het fototabblad van een kroeg in Google Maps heeft een categorie **Menu**. Als het verzoek `hspqX` (zie `tools/google-kroegen/bron/fotos.mjs`) een parameter heeft voor die categorie, kunnen we eerst alleen de menufoto's ophalen en de volledige fotolijst alleen als terugval gebruiken. Dat scheelt verzoeken aan Google en foto's voor de modellen.

### Wat er geprobeerd is

9 november 2026, vanuit een cloudsessie van Claude: **niets live**. Google Maps aansturen vanuit die sessie werd geweigerd, en vanaf een datacenter volgt toch snel een CAPTCHA (zie hierboven). Er is dus geen verzoek naar Google gegaan, en `--alleen-menu` is niet gebouwd.

Wat de code al laat zien. Het verzoek dat we nu sturen (`fotolijstVerzoek` in `bron/fotos.mjs`) heeft deze delen:

| Deel van de argumenten | Wat we denken dat het is |
|---|---|
| `[dataId, null, ..., 0]` | de plaats |
| `[null, 20, token, null, 1]` | pagina: aantal en token voor de volgende pagina |
| `[KOLOMMEN, 1]` | welke velden per foto terugkomen |
| `[[[[[[2]]], [195, 195], 20]]]` | onbekend; mogelijk het filter of de soort weergave (de `[2]` is een kandidaat voor de categorie) |
| `[null, 1, null, 1]` | onbekend |

Een categorie zit waarschijnlijk in een van de twee onbekende delen, maar dat is een vermoeden en geen meting.

### Zo zoek je het uit (thuis, met de hand)

Volg de spelregels: hooguit twee of drie kroegen, ruime pauzes, bij een CAPTCHA stoppen.

1. Open in Chrome een kroeg met veel foto's in Google Maps (bijvoorbeeld St. Anneke) en open de ontwikkelaarshulpmiddelen (F12), tabblad Network. Typ `hspqX` in het filter.
2. Klik op de foto's van de kroeg en dan op **Alle**. Klik op het nieuwe verzoek, tabblad Payload, en kopieer de waarde van `f.req`.
3. Klik op **Menu** en kopieer weer `f.req`. Kopieer ook het begin van het antwoord (tabblad Response): daarin staat het aantal foto's.
4. Maak de twee leesbaar, elk in een eigen bestand, en vergelijk ze (bijvoorbeeld in VS Code: rechtsklik, Compare Selected):

```bash
node -e "const f=require('fs').readFileSync(0,'utf8').trim();const a=JSON.parse(JSON.parse(decodeURIComponent(f))[0][0][1]);console.log(JSON.stringify(a,null,1))" < alle.txt > alle.json
```

5. Herhaal bij een tweede kroeg om te zien of het verschil hetzelfde is. Zet het verschil en de aantallen foto's (Alle tegen Menu) hieronder.

### Uitslag

Nog niet onderzocht. Lukt het, dan bouwt een volgende sessie `--alleen-menu` (standaard als eerste ronde, met de volledige fotolijst als terugval) en meet hoeveel minder foto's en verzoeken het kost. Lukt het niet, dan komt hier wat er geprobeerd is.

## JAN vanuit een cloudsessie met DeepSeek (21 november 2026)

`node menufotos.mjs --kroegen <bestand> --extern --sinds 2024-11-01 --max-fotos 150`, met `NODE_USE_ENV_PROXY=1` (anders gaat Node buiten de proxy om en ontbreekt de DeepSeek-sleutel) en `tools/google-kroegen/node_modules/playwright` als koppeling naar de vooraf geïnstalleerde Playwright. 49 kroegen zonder prijs, de klassieke cafés in het centrum eerst.

| | |
|---|---|
| Kroegen | 49, geen CAPTCHA, ongeveer 30 minuten |
| Zonder foto's sinds november 2024 | 16 |
| Foto's bekeken | 336, waarvan 82 als kaart aangemerkt |
| DeepSeek | 136 verzoeken, 68.452 tokens in, 35.100 uit, ongeveer $ 0,03 |
| Prijzen | 1, afgekeurd |

De enige prijs was De Tempelier, "Heineken 25 cl € 2,50": een weekkalender met "Knaken dinsdag: Heineken vaas voor € 2,5 vanaf 20.00 uur". Een actieprijs, geen gewone prijs. Twee fouten in de pijplijn lieten hem door, beide gerepareerd:

- `mediaanUitDatabase()` in `menufotos.mjs` telde alleen bevestigde prijzen (2 in Nijmegen, minder dan de 5 die nodig zijn), dus de controle op 30% van de mediaan stond uit. Nu tellen menukaartprijzen mee, zoals in de Pilsindex (`per25VoorMediaan()` in `bron/controles.mjs`, met test): 18 prijzen, mediaan € 3,90, en € 2,50 wijkt 36% af.
- De lezer kende geen actieprijzen. Het veld `actie` in de opdracht van de lezer (`bron/menulezer.mjs`) markeert happy hour, dagaanbiedingen en weekkalenders, en `kiesVaasje()` slaat ze over (met test). De menukaart-controleur keurt een actieprijs ook af.

Conclusie: de meeste Nijmeegse kroegen zonder prijs hebben in Google Maps geen leesbare kaart met de pils van de tap. Wat overblijft, komt van spelers ter plaatse.

## Proef: DAEN vanuit een cloudsessie (9 november 2026)

Vanuit de cloud zijn Google Maps en LM Studio niet bereikbaar, de websites van kroegen wel. Claude (de hoofdsessie) zocht daarom bij Nijmeegse kroegen zonder prijs de drankkaart op de eigen website. Lokale modellen en DeepSeek zijn niet gebruikt.

| Kroeg | Bron | Vaasje | Datum |
|---|---|---|---|
| Café Wunderkammer | drankkaart als afbeelding op de website (24 pagina's; OCR vond de bierpagina, Claude las hem) | Grolsch 25 cl € 3,80 | 2026-09-09 (upload in de mediabibliotheek; de afbeelding heeft geen EXIF) |
| De Kluizenaar | dranken-pagina | Mokum Bier Pilsener (Heineken) 25 cl € 3,80 | 2026-10-05 (Webflow, `Last Published`) |
| Café Faber | menukaart-pagina, "Heineken fluit / vaas 3.60 / 3.90" | Heineken € 3,90 | 2026-06-16 (WordPress, `modified`) |
| Café Lux | menukaart-pagina, "Grolsch Pils (0,25 L/0,5 L) 3,9 / 7,2" | Grolsch 25 cl € 3,90 | 2026-10-07 (`dateModified`) |
| Brouwerij Florijn | dranken-pagina, "Heineken fluit 3.6 / vaas 3.9" (DNB is hun eigen blond, geen pils) | Heineken € 3,90 | 2026-09-23 (WordPress, `modified`) |

Eerst was bij vier kroegen de dag van het bekijken (9 november 2026) als datum ingevoerd. Dat was fout: de datum hoort bij de kaart, niet bij ons bezoek. Dezelfde avond rechtgezet in de database (`op` en `bron_omschrijving` van deze vijf rijen).

Afgevallen: Café Maxim (alleen Brand in 22 cl), Café Jos (geen prijzen op de site), en kroegen zonder bereikbare site of drankkaart.

Elke prijs is nagekeken door de subagent menukaart-controleur (Haiku). Die keurde De Kluizenaar eerst af: in de platte tekst stond de maat niet bij de prijs. In de HTML staan prijs (3,6 / 3,8 / 6,7) en maat (18 / 25 / 50 cl) in hetzelfde kaartje; met die bron keurde hij de prijs goed. Daarna de vaste controles (bereik, mediaan € 3,90, datum) en de import via `importeer_menuprijzen`: 5 toegevoegd, 0 overgeslagen. De eerste poging liep vast op de grens van 80 tekens voor `bron_omschrijving`; `naarMenuImport` houdt zich daar nu aan.

Herhalen: zie Werkwijze in het kort, bovenaan.

## Tweede ronde DAEN vanuit een cloudsessie (21 november 2026)

Alle open Nijmeegse kroegen zonder prijs en zonder openstaande melding (ongeveer 150). Geen lokale modellen of DeepSeek; Claude las elke kaart zelf, als tekst en als afbeelding, en de menukaart-controleur keek elk geval na (`nakijken/2026-11-21-daen/`, niet in Git).

Werkwijze, voor een volgende keer:

1. **Websites uit OpenStreetMap.** De `osm_id` van de kroegen in de database, per 50 opgevraagd bij `https://api.openstreetmap.org/api/0.6/nodes.json?nodes=...` (tags `website`, `contact:website`, `website:menu`). Overpass gaf vanuit de cloud steeds een time-out; de gewone OSM-API werkt wel. 52 van de 79 OSM-kroegen zonder prijs hadden een website.
2. **Crawlen.** Per site de startpagina en hoogstens 12 links met menu, kaart, drank, bier, tap of pdf in de tekst of het adres; pdf's met `pdftotext -layout`; bij WordPress ook `/wp-json/wp/v2/media?search=drank` (en menu, kaart, bier) voor uploaddatums en `/wp-json/wp/v2/pages` voor `modified`. Sites die hun menu met JavaScript tonen (34) nog een keer met Playwright.
3. **Zoeken** naar regels met een pilsmerk of pils, vaas, fluit, tap of 25 cl met een bedrag erbij, en elke treffer daarna zelf lezen op de kaart (pdf-pagina als afbeelding met `pdftoppm`).
4. **Kroegen zonder website in OSM** (ongeveer 100, vooral uit Google): vier Haiku-agents zochten de eigen website en drankkaart. Dat leverde weinig op: de meeste kleine kroegen hebben geen site, of alleen Facebook en Instagram.

Geïmporteerd (allemaal goedgekeurd door de controleur en door de vaste controles; mediaan van de stad € 3,90):

| Kroeg | Vaasje | Datum | Bron van de datum |
|---|---|---|---|
| In de Blaauwe Hand | Hertog Jan 25 cl € 4,10 | 2026-11-02 | pdf (ModDate) |
| De Plak | Gulpener vaasje 0,25 L € 3,80 | 2026-11-11 | `lastmod` van de pagina in `sitemap.xml` (Drupal) |
| Cafe van Ouds | Heineken vaasje € 3,90 | 2025-03-21 | pdf (ModDate) |
| Café Maxim | Brand 25 cl € 3,60 | 2026-02-16 | pdf (ModDate en bestandsnaam) |
| YUCA | Hertog Jan tap 0,25 L € 3,95 | 2026-09-27 | `Last-Modified`, gelijk bij herhaald opvragen |
| Blonde Pater | Grolsch Pilsner 25 cl € 3,80 | 2026-11-09 | pdf (ModDate) |
| Café De Deut | Brand vaasje € 3,90 | 2025-04-08 | pdf (ModDate) |
| Café De Opera | Brand 0,25 l € 3,90 | 2025-08-18 | pdf (ModDate) |
| De Ruyter | Grolsch vaas € 3,50 | 2026-09-19 | pdf (ModDate en bestandsnaam); na het gelijktrekken van de regel voor "vaas" opnieuw nagekeken |
| HOLT | Swinckels 0,25 l € 3,90 | 2026-03-20 | pdf (ModDate); gevonden door een Haiku-agent |
| Funkenstein | Gulpener 0,25 L € 3,80 | 2026-11-02 | `modified` van de pagina in `/wp-json/wp/v2/pages`; gevonden door een Haiku-agent |

Uitslag: 11 kroegen erbij. Nijmegen ging van 11 van de 164 naar 22 van de 161 open kroegen in kaart (drie zaken die geen kroeg zijn, zijn gesloten, zie hieronder), waarvan 16 menukaartprijzen.

Afgevallen, met reden:

- **De Ruyter**: "Grolsch vaas 3,5" zonder maat; de controleur keurde "vaas" eerst af, omdat de regel alleen het woord "vaasje" accepteerde, terwijl bij Café Faber en Brouwerij Florijn (9 november) "vaas" wel als vaasje telde. Daarna is de regel gelijkgetrokken: "vaas" telt als vaasje (in `vaasje.mjs`, de controleur en dit document). Opnieuw nagekeken en geïmporteerd.
- **Geen maat bij het kleine glas**: Café Eten en Drinken Lent (Peroni 3,80), Freddy's (Heineken S/M/L 3,8/4/7,2), Tierney's (Heineken glass/pint 3,9/7,6), Bar Socio (Peroni 3,8), Café Piet Huisman (Heineken 3,8, met 18 en 50 cl apart), Atelier (Stella Artois 3,9).
- **Grand Café Moenen**: Hertog Jan 0,25 L € 4,00 op de kaart van najaar 2025, maar er is een nieuwere kaart (zomer 2026, geüpload 1 september 2026) waarvan de bladzijde met tapbieren niet online staat. De nieuwste kaart wint, en die kennen we niet.
- **Geen tapprijs op de kaart**: Brouwtoren ("kijk op het scherm"), Café Jos (tapbieren met maat maar zonder prijs), PAAK (alleen fles), Frowijn (alleen een huisbier zonder maat).

Bevindingen over de kroegenlijst zelf: Dreadlock en Kronkel aan de Vlaamsegas zijn coffeeshops en Park Café heeft een vergunning voor droge horeca; die drie zijn op 21 november 2026 gesloten (`open = false`, `gesloten_door_spelers = true`, zodat een nieuwe import ze niet weer opent). Nog niet aangepast: op Hertogstraat 127 (Café Royal) zit volgens In Your Pocket nu 't Hoofdkantoor; Strik Bakkers Cafe is een ijssalon.

## Proef: Café Van Buren (Molenstraat 89)

6 november 2026.

| Stap | Uitkomst |
|---|---|
| DAEN: website cafevanburen.nl | Menu-, lunch-, vegan-, Big Green Egg- en wijnpagina's; geen bier of prijzen van drank |
| DAEN: mediabibliotheek (zoeken op drank, bier, kaart, menu, tap, pdf, en de 40 nieuwste uploads) | Eetkaarten, wijnkaarten, pubquiz- en evenementposters; geen drankkaart |
| JAN: fotolijst via Google Maps | 360 foto's. Na een paar verzoeken toonde Google vanuit de cloudsessie een CAPTCHA; 20 foto's binnen |
| JAN: kaarten herkennen (DeepSeek) | 3 van de 17 foto's als mogelijke kaart aangemerkt (bordjes met een QR-code om te bestellen) |
| JAN: kaarten lezen | Geen bierprijzen op die foto's, dus terecht geen prijs |
| JAN: EXIF | Werkt: bijvoorbeeld opname 4 juni 2024 bij een upload van 3 oktober 2024 |

Ter controle las het model de drankkaart van Café Daen als afbeelding: Hertog Jan en Jupiler 25 cl €4,00, gelijk aan de pdf.

St Anneke (St. Annastraat 55), zelfde dag: 132 foto's in Google; voordat Google een CAPTCHA toonde kwamen er 10 binnen. Het krijtbord achter de bar (foto genomen 4 juni 2013) werd gevonden en gelezen: Paulaner, witbier, Max Rosé en Omer, maar geen pils, dus terecht geen vaasjesprijs.

Conclusie: Van Buren laat bestellen via een QR-code en heeft weinig kaarten op tafel. Of er tussen de andere 340 foto's een kaart met prijzen zit, laat een run vanaf een thuisverbinding zien.

## Gent: DAEN en Haiku-agents vanuit een cloudsessie (25 november 2026)

Eerste ronde in een Belgische stad: alle 367 open kroegen in Gent zonder prijs. De JAN-methode (foto's in Google Maps) is niet gebruikt: de Gentse kroegen komen uit OpenStreetMap en hebben geen Google Place ID, en die eerst bij Google opzoeken vraagt veel verzoeken vanaf een datacenter.

Werkwijze:

1. **Websites uit OpenStreetMap** via de OSM-API (nodes en ways per 50): 109 van de 367 kroegen hebben een website.
2. **Crawlen** zoals in Nijmegen: startpagina en links met menu, kaart, drank, bier of pdf, pdf's met `pdftotext -layout`, daarna sites met weinig tekst of een fout nog een keer met Playwright. Gezocht op Belgische pilsmerken (Jupiler, Stella Artois, Maes, Primus, Cristal, Bavik, Martens, Bockor) met een bedrag.
3. **Haiku-agents** (13, elk ongeveer 20 kroegen) zochten de eigen website en drankkaart van de 258 kroegen zonder website in OSM. De zoekbudget van de sessie (gedeeld door alle agents) raakte halverwege op, dus ongeveer de helft is niet gezocht. Wat wel gezocht is, leverde weinig op: de meeste kroegen staan alleen op Facebook, Instagram of verzamelsites, en die tellen niet als bron.
4. **Nakijken**: elke prijs zelf gelezen, met een uitsnede uit de pdf (`pdftoppm`, regel opgezocht met `pdftotext -bbox-layout`) of een schermafbeelding van de pagina, en de menukaart-controleur keurde elk geval. Op Belgische kaarten staat de maat er meestal bij (25 cl, het pintje); zonder maat geen prijs.

Geïmporteerd (allemaal goedgekeurd door de controleur en door de vaste controles; mediaan € 3,20):

| Kroeg | Pintje (25 cl, van het vat) | Datum | Bron van de datum |
|---|---|---|---|
| 5 voor 12 | Primus € 3,20 | 2024-10-14 | pdf (ModDate) |
| Café Merino | Stella Artois € 3,00 | 2025-03-11 | datum in de titel van de kaart |
| The Celtic Towers | Stella Artois € 3,00 | 2025-05-22 | `dateModified` van de pagina; gevonden door een Haiku-agent |
| Bar Bassie | Stella Artois € 3,30 | 2026-06-25 | pdf (ModDate) |
| the Wan & Only | Cristal € 3,20 | 2026-09-22 | pdf (ModDate) |
| VIERNULVIER Café | Cristal € 3,20 | 2026-09-24 | pdf (ModDate) |
| Trollenkelder | Stella Artois € 3,20 | 2026-11-23 | `Last-Modified` van de pagina, vast bij herhaald opvragen; website gevonden door een Haiku-agent |

Uitslag: 7 van de 367 kroegen in kaart, de eerste Pilsindex van Gent (€ 3,20).

Afgevallen, met reden:

- **Geen maat bij de pils**: Eltòn (Stella Artois van het vat 3,3), ABA-JOUR (Bavik superpils van het vat 3,20), Fluoclub (pilsner 3,5).
- **Geen pils van de tap in 25 cl**: De Dulle Griet (Mongozo Pilsener in fles), Café Cannelle (Jupiler in flesje), Amaro (Peroni 33 cl).
- **Niet te lezen**: Bar Martine (pdf geeft 403), 19 sites gaven een fout of bestaan niet meer.

Wat nog kan: de kroegen die de agents door het zoekbudget niet konden zoeken opnieuw laten zoeken (in een nieuwe beurt, met minder agents tegelijk), en de JAN-methode zodra de Gentse kroegen een Google Place ID hebben.

### Tweede ronde Gent: DeepSeek leest alle websites (25 november 2026)

- **Zoeken naar websites.** Vijf Haiku-agents zochten met een zoekopdracht per kroeg de eigen website van de 100 kroegen die in de eerste ronde niet aan bod kwamen. Geen enkele gevonden: alle 258 kroegen zonder website in OSM zijn nu gezocht.
- **Lezen met DeepSeek.** Van de 116 kroegen met een website (109 uit OSM, 7 gevonden door agents) gingen alle opgehaalde pagina's en pdf's naar DeepSeek (`deepseek-flash`, via de proxy van de sessie), met de vraag om alle bieren van het vat met soort, maat, prijs, de letterlijke regel en datumaanwijzingen. 108 kroegen, ongeveer 400.000 tokens in en 180.000 uit. 26 kroegen hebben een drankkaart met tapbieren online.
- **Alle tapbieren bewaard** in `tools/google-kroegen/data/gent-tapbieren-2026-11-25.json` (21 kroegen, 221 tapbieren, niet nagekeken), om later te beslissen of het goedkoopste bier van het vat als vergelijking meetelt, zoals Dulle Griet Blond (€ 3,60) bij De Dulle Griet, die geen pils van de tap heeft.
- **Nieuwe regel voor België**: een pils van het vat zonder maat telt als pintje van 25 cl als de prijs binnen 15% van de Pilsindex van de stad ligt (in Gent € 2,72 tot € 3,68). Spelers corrigeren het als het niet klopt. De menukaart-controleur kent de regel (`.claude/agents/menukaart-controleur.md`).

Daarna elke nieuwe kandidaat zelf nagelezen en door de controleur goedgekeurd:

| Kroeg | Pintje (van het vat) | Datum | Bron van de datum |
|---|---|---|---|
| Marimain | Stella Artois 25 cl € 3,00 | 2026-11-24 | `Last-Modified` van de startpagina, vast bij herhaald opvragen |
| St.-Martinus Snooker/Pool | Primus 25 cl € 3,00 | 2026-01-22 | `lastmod` in `sitemap.xml` |
| ABA-JOUR | Bavik superpils € 3,20, maat aangenomen | 2026-11-15 | pdf (ModDate en bestandsnaam) |
| Eltòn | Stella Artois € 3,30, maat aangenomen | 2025-05-28 | pdf (ModDate, "Mei 2025") |

Uitslag: Gent van 7 naar 11 kroegen in kaart, Pilsindex € 3,20.

Afgevallen: Artevelde Brouwerij (huispils 25 cl € 3,30, maar niet duidelijk van de tap, en de site vraagt eerst of je ouder dan 18 bent; die vraag beantwoordt een sessie niet), Bar Dada (Vedett 25 cl € 3,70 van de tap, geen datum), Fluoclub (pils zonder maat en niet duidelijk van de tap).

Sinds deze ronde doet DeepSeek het lezen en nakijken; Haiku-agents worden niet meer ingezet, omdat Claude-gebruik schaars is. Zoeken naar websites kan DeepSeek niet (geen zoekfunctie); bij Gent leverde dat met agents ook niets meer op.
