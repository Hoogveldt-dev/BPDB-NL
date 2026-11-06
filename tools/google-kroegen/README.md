# google-kroegen

Haalt alle cafés en kroegen van een gemeente uit Google Maps en koppelt ze aan de kroegen uit OpenStreetMap in de BPDB-database. Achtergrond en vergelijking van de bronnen: [`docs/google-maps-bronnen.md`](../../docs/google-maps-bronnen.md).

Geen afhankelijkheden voor de gewone werking (Node 20 of nieuwer). Playwright is alleen nodig voor de terugvaloptie in de browser.

## Gebruik

Proef op een punt (de Grote Markt in Nijmegen, een zoekterm):

```bash
node cli.mjs --punt 51.8475,5.8635 --zoektermen kroeg --max-paginas 2
```

Heel Nijmegen (gemeentegrens van het CBS via PDOK), resultaat in `google-kroegen-nijmegen.json`:

```bash
node cli.mjs --gemeentecode GM0268
```

Een andere gemeente, bijvoorbeeld Arnhem:

```bash
node cli.mjs --gemeentecode GM0202
```

Direct importeren in Supabase (eerst de migratie `20261106120000_google_kroegen` toepassen):

```bash
SUPABASE_URL=https://<project-ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<geheim> node cli.mjs --gemeentecode GM0268 --naar-supabase
```

Zet de service_role-key nooit in git of in de app. `node cli.mjs --hulp` toont alle opties.

Terugvaloptie installeren (alleen nodig als Google het directe verzoek blokkeert):

```bash
npm install
```

```bash
npx playwright install chromium
```

## Wat er gebeurt

1. De gemeentegrens wordt opgedeeld in cellen van 1,5 km. Alleen cellen die de grens raken tellen mee.
2. Per cel en zoekterm (`kroeg`, `café`, `bar`, `pub`) haalt de tool pagina's van 20 resultaten op, tot een pagina niets nieuws meer oplevert.
3. Elke plaats wordt gelezen uit de JSON die Google Maps zelf gebruikt. Alleen plaatsen binnen de gemeentegrens met een kroegcategorie blijven over, ontdubbeld op Place ID.
4. Bij `--naar-supabase` koppelt de database ze aan bestaande kroegen of voegt ze toe.

| Onderdeel | Bestand | Herkomst |
|---|---|---|
| Veilige padlezer | `bron/pad.mjs` | gosom (MIT) |
| Raster en gemeentegrens | `bron/raster.mjs`, `bron/gebied.mjs` | gosom (MIT), randfout opgelost; PDOK zoals `osm-import` |
| Zoek-URL met paginering | `bron/zoekurl.mjs` | gosom (MIT), paginering toegevoegd |
| JSON-ontleding | `bron/ontleed.mjs` | gosom (MIT), paden gecontroleerd en bijgewerkt |
| HTTP- en browsertransport | `bron/transport.mjs` | gosom en conor-is-my-name (MIT) |
| Kroeg of niet | `bron/classificeer.mjs` | eigen, op basis van Nederlandse Google-categorieën |
| Veldgezondheid | `bron/gezondheid.mjs` | idee van google-reviews-scraper-pro (MIT) |
| Import en koppeling | `supabase/migrations/20261106120000_google_kroegen.sql` | eigen |

## Kroeg of niet

| Zekerheid | Regel | Voorbeeld |
|---|---|---|
| hoog | Hoofdcategorie is een kroegcategorie | Café; Cocktailbar, Bar; Ierse pub |
| middel | Kroegcategorie op plek 2 of 3 | Brouwerij, Café, Restaurant |
| geen | Anders, of een cannabiswinkel | Restaurant; Koffiehuis; Cannabiswinkel, Loungebar |

Met `--alleen-zeker` blijven alleen de zaken met zekerheid "hoog" over. Nachtclubs en discotheken alleen met `--clubs`.

## Als het misgaat

| Melding | Betekenis | Wat te doen |
|---|---|---|
| `Verplichte velden te vaak leeg` | Google heeft de structuur van de JSON veranderd | Paden in `bron/ontleed.mjs` bijwerken; vergelijk met de laatste versie van gosom (`gmaps/entry.go`, `gmaps/multiple.go`) |
| `Google blokkeert` | Te veel verzoeken of een verdacht IP-adres | Later opnieuw, `--pauze-ms` verhogen, of `--transport browser` |
| `Playwright ontbreekt` | De terugvaloptie is niet geïnstalleerd | `npm install` en `npx playwright install chromium` |

## Testen

```bash
npm test
```

De tests gebruiken een nagebouwd Google-antwoord (`test/nep-google.mjs`) met alleen de indexen die de tool leest. Als Google iets verandert, pas je daar het pad aan en in `bron/ontleed.mjs`.

## Spelregels

Automatisch uitlezen van Google Maps is in strijd met de gebruiksvoorwaarden van Google. Het gaat om openbare bedrijfsgegevens; gebruik de tool met mate (een run per gemeente per paar weken), haal geen reviews of persoonsgegevens op, en draai hem niet vanaf gedeelde servers.
