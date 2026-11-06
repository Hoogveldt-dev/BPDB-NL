# Google Maps als bron: wat we uit 7 open source scrapers halen

Onderzocht op 6 november 2026: de 7 projecten die in [Hoogveldt-dev/BPDB-barcollection](https://github.com/Hoogveldt-dev/BPDB-barcollection) als submodule staan. Doel: op een betrouwbare manier alle cafés en kroegen van een gemeente uit Google Maps halen en koppelen aan de kroegen uit OpenStreetMap.

Let op: in BPDB-barcollection staan de submodules alleen in `.gitmodules`; de verwijzingen naar commits ontbreken, dus `git clone --recursive` haalt niets op. Voor dit onderzoek zijn de projecten los opgehaald.

## Vergelijking

| Project | Taal, licentie | Werkwijze | Betrouwbaarheid | Wat we gebruiken |
|---|---|---|---|---|
| [gosom/google-maps-scraper](https://github.com/gosom/google-maps-scraper) | Go, MIT | Leest de JSON die Google Maps zelf gebruikt (`APP_INITIALIZATION_STATE` en het zoek-endpoint `/search?tbm=map`) met vaste indexpaden. Raster over een gebied. "Fast mode" zonder browser. | Hoog. JSON verandert minder vaak dan de opmaak; paden worden actief bijgehouden. | Zoek-URL (`pb`), indexpaden, veilige padlezer, rasterberekening, cookie-afwijzing. |
| [conor-is-my-name/google-maps-scraper](https://github.com/conor-is-my-name/google-maps-scraper) | Python, MIT | Playwright, HTML ontleden met een rangorde: `aria-label` en `data-item-id` eerst, verborgen CSS-klassen als laatste. | Middel. Goede rangorde, maar HTML-tekst is taalafhankelijk ("Address:"). | Rangorde van stabiliteit als ontwerpregel; cookie-afhandeling in de browser. |
| [georgekhananaev/google-reviews-scraper-pro](https://github.com/georgekhananaev/google-reviews-scraper-pro) | Python, MIT | Reviews; SQLite met sessies, wijzigingshistorie, selector-telemetrie. | Hoog voor reviews. | Idee van veldgezondheid (selector health): de run stopt als verplichte velden leeg raken. Volgorde van ID's (CID, hex-ID, link). |
| [Zubdata/Google-Maps-Scraper](https://github.com/Zubdata/Google-Maps-Scraper) | Python, GPL-3.0 | Selenium met GUI, BeautifulSoup op CSS-klassen. | Laag: klassen als `ceNzKf` veranderen. | Niets. GPL-code nemen we niet over. |
| [HasData/google-maps-scraper](https://github.com/HasData/google-maps-scraper) | Python en Node, geen licentie | Voorbeeldscripts (Selenium, Playwright) en reclame voor een betaalde API. | Laag: lange CSS-klasseketens. | Niets (geen licentie = niet hergebruiken). |
| [luminati-io/Google-Maps-Scraper](https://github.com/luminati-io/Google-Maps-Scraper) | Python, geen licentie | Reviewscraper op CSS-klassen en reclame voor Bright Data. | Laag. | Niets. |
| [omkarcloud/google-maps-scraper](https://github.com/omkarcloud/google-maps-scraper) | Geen broncode | Alleen een README voor een gesloten desktop-app. | Niet te beoordelen. | Niets. |

## Wat we gemeten hebben

Live tegen Google Maps voor Nijmegen (6 november 2026):

- Het zoek-endpoint `/search?tbm=map` geeft zonder browser JSON terug met 20 plaatsen per keer, inclusief naam, Place ID, categorieën, adres, coördinaten, beoordeling, telefoon, website en openingstijden.
- **Paginering werkt** met `!8i<offset>` (0, 20, 40, ...). gosom haalt alleen de eerste 20 op; met paginering halen we per zoekpunt veel meer op en zijn minder rastercellen nodig.
- De paden van gosom kloppen nog, met twee afwijkingen: openingstijden staan op `[203][0]`, en `[88][0]` is in zoekresultaten geen sluitstatus maar bijvoorbeeld "Honden toegestaan".
- Google laat **definitief gesloten zaken weg** uit de zoekresultaten (in 360 resultaten in Nijmegen en Amsterdam kwam geen enkele sluitstatus voor). Sluiten leiden we daarom af uit "bij volledige runs niet meer gezien".
- Categorieën zijn alleen als vertaalde tekst beschikbaar (geen vaste ID's). In het Nederlands betekent "Café" een kroeg; een koffiezaak heet "Koffiehuis" of "Koffiebar"; een coffeeshop heet "Cannabiswinkel".
- Dezelfde aanroep vanuit een echte browser (Playwright) geeft hetzelfde antwoord. Dat is onze terugvaloptie als Google het directe verzoek blokkeert.
- In gosoms raster bleef langs de noord- en oostrand een strook onbedekt als het gebied geen veelvoud van de celgrootte is. Dat is in onze versie opgelost.

## Gekozen opzet

```
PDOK gemeentegrens ──> raster van cellen (1,5 km) ──> per cel x zoekterm x pagina
                                                          │
                              transport: http (snel) ─────┤ bij blokkade: browser (Playwright)
                                                          ▼
                                 een ontleding van de JSON (indexpaden)
                                                          ▼
                         veldgezondheid ── stopt bij structuurwijziging
                                                          ▼
                     binnen de gemeentegrens? kroegcategorie? ontdubbelen op Place ID
                                                          ▼
                          JSON-bestand  ──>  importeer_google_kroegen (Supabase)
                                                koppelt aan OSM (afstand + naam)
```

Waarom zo:

1. **JSON in plaats van HTML.** De structuur van de data verandert minder vaak dan de opmaak, en is niet afhankelijk van de taal van de knoppen.
2. **Een ontleding, twee transporten.** Als Google het directe verzoek blokkeert, doet de browser exact hetzelfde verzoek. Er is dus geen tweede, afwijkende scraper om te onderhouden.
3. **Hard stoppen bij twijfel.** Liever geen import dan een halve: als naam, Place ID, coördinaten of categorieën bij meer dan 10% ontbreken, stopt de run met een duidelijke melding.
4. **OSM blijft leidend.** Een Google-plaats wordt gekoppeld aan een OSM-kroeg binnen 15 m, of tot 75 m bij een gelijkende naam (trigram-vergelijking op de kern van de naam, zonder "café", "bar" en emoji). Google vult telefoon, website, openingstijden en beoordeling aan en voegt kroegen toe die in OSM ontbreken.
5. **Voorzichtig met Google.** Een verzoek tegelijk, ongeveer 1,2 seconde pauze met spreiding, terugtrekken bij HTTP 429.

## Spelregels en risico's

- Automatisch uitlezen van Google Maps is in strijd met de gebruiksvoorwaarden van Google. Het gaat om openbare bedrijfsgegevens, maar Google kan verzoeken blokkeren. Gebruik de tool met mate (een run per gemeente per paar weken is genoeg) en niet vanaf servers van derden.
- Sla geen persoonsgegevens op: we halen geen reviews of namen van reviewers op.
- De officiële Google Places API is het betrouwbare alternatief als de tool structureel geblokkeerd raakt; die kost geld per verzoek en heeft eigen voorwaarden voor opslag.
