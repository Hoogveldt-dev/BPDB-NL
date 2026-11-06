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

## JAN-methode: foto's van de kaart in Google Maps

Genoemd naar Stadscafé Jan (vaasje €3,90 op 20 december 2025, van een menufoto). Sinds 6 november 2026 automatisch met `tools/google-kroegen/menufotos.mjs`:

1. **Fotolijst.** De tool opent de kroeg in Google Maps in een browser en vraagt vanuit die pagina de fotolijst op (de RPC `hspqX`, die Google Maps zelf gebruikt). Per foto: ID, soort, adres van de afbeelding en uploaddatum. 10 foto's per verzoek, met pauzes.
2. **Kaarten herkennen.** Miniaturen (256 px) gaan in groepjes van 10 naar een vision-model: welke tonen een drankkaart of prijsbord?
3. **Datum.** Van elke kandidaat haalt de tool het origineel (`=s0`). Google laat daarin de EXIF-gegevens van de maker staan: `DateTimeOriginal` is het moment van de foto. Zonder EXIF telt de uploaddatum.
4. **Prijs.** Een leesbare versie (1600 px) gaat naar het model, dat de bieren met maat en prijs teruggeeft. `kiesVaasje` kiest de goedkoopste pils van de tap in 25 cl; zonder maat alleen bij het woord "vaasje". Twijfel ("medium") = geen prijs.
5. **Nieuwste kaart wint.** Per kroeg de prijs met de nieuwste datum, als rij voor `importeer_menuprijzen`.

Model: standaard DeepSeek (`deepseek-flash`, leest afbeeldingen), via `DEEPSEEK_API_KEY`. Elk ander model in het OpenAI-formaat kan via `MENU_MODEL_URL` en `MENU_MODEL`. Een kroeg kost een paar duizend tokens, dus fracties van een cent.

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

Conclusie: Van Buren laat bestellen via een QR-code en heeft weinig kaarten op tafel. Of er tussen de andere 340 foto's een kaart met prijzen zit, laat een run vanaf een thuisverbinding zien.
