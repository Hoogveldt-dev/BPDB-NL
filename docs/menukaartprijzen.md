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
2. **Schiften (ruim, goedkoop).** Per 20 foto's, nieuwste upload eerst, een contactblad: miniaturen van 240 px met een nummer in een afbeelding. Het model noemt zonder na te denken de nummers waarop een kaart of krijtbord te zien is.
3. **Controleren (streng, goedkoop).** Elke kandidaat apart op 768 px, zonder nadenken: staan er bierprijzen op die je kunt lezen? QR-bordjes, eten en sfeerfoto's vallen hier af.
4. **Datum.** Van wat overblijft haalt de tool het origineel (`=s0`). Google laat daarin de EXIF-gegevens van de maker staan: `DateTimeOriginal` is het moment van de foto. Zonder EXIF telt de uploaddatum.
5. **Lezen (duur, alleen als het moet).** Een leesbare versie (1600 px) gaat naar het model, nu met nadenken (zonder leest het slordig: in de proef werd €3,50 dan €2,30). `kiesVaasje` kiest de goedkoopste pils van de tap in 25 cl; zonder maat alleen bij het woord "vaasje". Twijfel ("medium") = geen prijs.
6. **Stoppen.** Levert een groep een vaasjesprijs op, dan kijken we niet verder naar oudere foto's.
7. **Nieuwste kaart wint.** Per kroeg de prijs met de nieuwste datum, als rij voor `importeer_menuprijzen`.

Model: standaard DeepSeek (`deepseek-flash`, leest afbeeldingen), via `DEEPSEEK_API_KEY`. Elk ander model in het OpenAI-formaat kan via `MENU_MODEL_URL` en `MENU_MODEL`. Met `--lokaal` draaien Qwen2.5-VL en Llama 3.2 Vision op de eigen computer, zonder kosten of limiet, met een tweede mening per prijs: zie `docs/lokale-vision.md`.

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
