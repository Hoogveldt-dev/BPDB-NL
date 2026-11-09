# Menukaartprijzen: de JAN-methode en de DAEN-methode

Menukaartprijzen vullen de prijsgeschiedenis voordat een speler een kroeg bezoekt. Ze tellen mee in de koers en de Pilsindex, maar zijn geen melding: ze staan niet in "Laatste meldingen" en niet in de activiteit van de lichtkrant. Ze verschijnen met het mist-effect tot een speler ter plaatse "Klopt, ik ben er" zegt; die speler wordt indiener, en daarna gelden de gewone regels (bevestiging door een andere speler). Invoer gaat altijd via `importeer_menuprijzen` (alleen `service_role`), met kroeg, merk, volume, prijs, datum en een omschrijving van de bron.

Het spel gebruikt alleen de goedkoopste pils van de tap in een vaasje (25 cl). Andere maten en bieren laten we voor nu liggen.

## DAEN-methode: de drankkaart van de eigen website

Genoemd naar Café Daen (6 november 2026: Hertog Jan 25 cl €4,00, drankkaart van 2 september 2026).

1. Zoek de website van de kroeg (staat in Google Maps of OSM).
2. Zoek de drankkaart: een link naar een pdf op de menupagina, of in de openbare mediabibliotheek van WordPress (`/wp-json/wp/v2/media?search=drank`).
3. Is de pdf opgemaakt met tekst, dan volstaat `pdftotext -layout`; geen AI nodig. Alleen een gescande pdf of een afbeelding gaat naar een vision-model (eerst Haiku of Sonnet, de betaalde DeepSeek-sleutel alleen als dat nodig is).
4. Datum: uit de bestandsnaam of de kaart zelf. Anders de map in de URL (`uploads/2026/09/`), `Last-Modified` van de server of de uploaddatum in de mediabibliotheek, in die volgorde.

Voordelen: de bron is de kroeg zelf, het is goedkoop en het mag. Nadeel: veel kroegen zetten alleen hun eetkaart online.

## JAN-methode: foto's van de kaart in Google Maps

Genoemd naar Stadscafé Jan (vaasje €3,90 op 20 december 2025, van een menufoto). Sinds 6 november 2026 automatisch met `tools/google-kroegen/menufotos.mjs`:

1. **Fotolijst.** De tool opent de kroeg in Google Maps in een browser en vraagt vanuit die pagina de fotolijst op (de RPC `hspqX`, die Google Maps zelf gebruikt). Per foto: ID, soort, adres van de afbeelding en uploaddatum. 10 foto's per verzoek, met pauzes.
2. **Goedkope filters (zonder model).** Bijna gelijke foto's binnen een kroeg (dHash) slaan we over; de nieuwste blijft. OCR zoekt bedragen: foto's met een bedrag gaan eerst, de rest pas als die niets opleveren (`--ocr filter` gooit ze weg, `--zonder-ocr` zet het uit). Zie `tools/google-kroegen/README.md`.
3. **Schiften (ruim, goedkoop).** Per 20 foto's, nieuwste upload eerst, een contactblad: miniaturen van 240 px met een nummer in een afbeelding. Het model noemt zonder na te denken de nummers waarop een kaart of krijtbord te zien is.
4. **Controleren (streng, goedkoop).** Elke kandidaat apart op 768 px, zonder nadenken: staan er bierprijzen op die je kunt lezen? QR-bordjes, eten en sfeerfoto's vallen hier af.
5. **Datum.** Van wat overblijft haalt de tool het origineel (`=s0`). Google laat daarin de EXIF-gegevens van de maker staan: `DateTimeOriginal` is het moment van de foto. Zonder EXIF telt de uploaddatum. Ligt de EXIF-datum na de upload of in de toekomst, dan stond de klok van de camera verkeerd en telt de uploaddatum. Een foto ouder dan tien jaar houden we, met een markering in de omschrijving.
6. **Lezen (duur, alleen als het moet).** Een leesbare versie (1600 px) gaat naar het model, nu met nadenken (zonder leest het slordig: in de proef werd €3,50 dan €2,30). `kiesVaasje` kiest de goedkoopste pils van de tap in 25 cl; zonder maat alleen bij het woord "vaasje". Twijfel ("medium") = geen prijs. Een prijs buiten € 2,00 tot € 7,50, of meer dan 30% van de mediaan van de stad af, gaat naar `twijfels`.
7. **Stoppen.** Levert een groep een vaasjesprijs op, dan kijken we niet verder naar oudere foto's.
8. **Nieuwste kaart wint.** Per kroeg de prijs met de nieuwste datum, als rij voor `importeer_menuprijzen`.

Model: standaard DeepSeek (`deepseek-flash`, leest afbeeldingen), via `DEEPSEEK_API_KEY`. Elk ander model in het OpenAI-formaat kan via `MENU_MODEL_URL` en `MENU_MODEL`. Met `--lokaal` draaien Qwen3.5 en Gemma 4 in LM Studio op de eigen computer, zonder kosten of limiet, met een tweede mening per prijs: zie `docs/lokale-vision.md`.

### Nakijken: Claude kijkt alleen waar het nodig is

De lezer geeft bij elke prijs ook aan waar de regel op de foto staat (`vak`) en waar de kop van de bierlijst staat (`kop`), als fractie van de foto. Na een run schrijft `menufotos.mjs` naar `nakijken/<datum>/` (niet in Git):

- alle `twijfels`: de modellen waren het oneens, of een vaste controle keurde de prijs af;
- een willekeurige steekproef van 10% van de prijzen waar beide modellen het eens waren (`--steekproef 0.1`, `0` voor geen). Zo meten we hoe vaak ze samen fout zitten.

Per geval een map met `uitsnede.jpg` (de prijsregel over de hele breedte, met marge en de kop erboven), `foto.jpg` (de hele foto op 1024 px) en `geval.json` (gelezen prijs, oordeel van lezer en kijker, reden). `rijen.json` bevat de prijzen waar beide modellen het eens waren.

Daarna, in Claude Code op de eigen computer:

1. Vraag: "Kijk `tools/google-kroegen/nakijken/<datum>` na met de menukaart-controleur en zet elk antwoord als `oordeel.json` in de map van het geval." De subagent `.claude/agents/menukaart-controleur.md` draait op Haiku, mag alleen lezen, bekijkt eerst de uitsnede en alleen bij twijfel de hele foto, en antwoordt met `{"is_menukaart", "prijs_klopt", "juiste_prijs", "toelichting"}`.
2. `node verwerk-oordelen.mjs nakijken/<datum>` maakt `nakijken/<datum>/nagekeken.json`: goedgekeurde twijfels erbij, afgekeurde steekproefprijzen eraf, en een rapport met hoe vaak de modellen samen fout zaten. Een andere prijs van de controleur (`juiste_prijs`) importeren we niet: liever geen prijs dan een verkeerde.
3. Kjell bekijkt het rapport en importeert zelf met `node verwerk-oordelen.mjs nakijken/<datum> --naar-supabase`.

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
- Vanaf een datacenter (zoals een cloudsessie) volgt die CAPTCHA al na een paar kroegen. Draai de tool vanaf een thuisverbinding.
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

### Zo zoekt Kjell het uit (thuis, met de hand)

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
