# Menukaartprijzen: de JAN-methode en de DAEN-methode

Menukaartprijzen vullen de prijsgeschiedenis voordat een speler een kroeg bezoekt. Ze verschijnen met het mist-effect tot een speler ter plaatse "Klopt, ik ben er" zegt; die speler wordt indiener, en daarna gelden de gewone regels (bevestiging door een andere speler). Invoer gaat altijd via `importeer_menuprijzen` (alleen `service_role`), met kroeg, merk, volume, prijs, datum en een omschrijving van de bron.

Het spel gebruikt alleen de goedkoopste pils van de tap in een vaasje (25 cl). Andere maten en bieren laten we voor nu liggen.

## DAEN-methode: de drankkaart van de eigen website

Genoemd naar Café Daen (6 november 2026: Hertog Jan 25 cl €4,00, drankkaart van 2 september 2026).

1. Zoek de website van de kroeg (staat in Google Maps of OSM).
2. Zoek de drankkaart: een link naar een pdf op de menupagina, of in de openbare mediabibliotheek van WordPress (`/wp-json/wp/v2/media?search=drank`).
3. Is de pdf opgemaakt met tekst, dan volstaat `pdftotext -layout`; geen AI nodig. Alleen een gescande pdf of een afbeelding gaat naar een vision-model (eerst Haiku of Sonnet, de betaalde DeepSeek-sleutel alleen als dat nodig is).
4. Datum: uit de bestandsnaam of de kaart zelf. Anders de map in de URL (`uploads/2026/09/`), `Last-Modified` van de server of de uploaddatum in de mediabibliotheek, in die volgorde.

Voordelen: de bron is de kroeg zelf, het is goedkoop en het mag. Nadeel: veel kroegen zetten alleen hun eetkaart online.

## JAN-methode: een foto van de kaart

Genoemd naar Stadscafé Jan (vaasje €3,90 op 20 december 2025, van een menufoto).

1. Een foto van de drankkaart: gemaakt door een speler, of een openbare foto van een bezoeker.
2. Datum: `DateTimeOriginal` uit de EXIF-gegevens van de foto (het moment van de opname, niet van uploaden). Uitlezen kan met `identify -format '%[EXIF:DateTimeOriginal]' foto.jpg` of met Pillow. Zonder EXIF: de uploaddatum, met lagere zekerheid.
3. Prijzen uitlezen met een vision-model. Staat er geen maat bij ("medium"), dan lagere zekerheid of overslaan.

Beperking: foto's uit Google Maps halen we niet automatisch op. Google toont een geautomatiseerde browser geen fotogalerij, en dat omzeilen doen we niet. Een foto moet dus van een speler of van iemand die hem zelf aanlevert komen.

## Proef: Café Van Buren (Molenstraat 89)

6 november 2026.

| Stap | Uitkomst |
|---|---|
| DAEN: website cafevanburen.nl | Menu-, lunch-, vegan-, Big Green Egg- en wijnpagina's; geen bier of prijzen van drank |
| DAEN: mediabibliotheek (zoeken op drank, bier, kaart, menu, tap, pdf, en de 40 nieuwste uploads) | Eetkaarten, wijnkaarten, pubquiz- en evenementposters; geen drankkaart |
| JAN: foto via Google Maps | Niet automatisch op te halen (zie hierboven) |

Conclusie: voor Van Buren werkt alleen de JAN-methode, met een foto die iemand aanlevert. Dit is precies het geval waarvoor de knop om een kaart te fotograferen in de app nuttig zou zijn.
