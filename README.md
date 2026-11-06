# BPDB-NL

Beer Price Database voor Nederland: een door gebruikers gevulde kaart met bierprijzen per kroeg. Iedereen speelt samen de hele stad vrij en houdt de prijzen vers. Pilotstad: Nijmegen. Guindex (guindex.ie) is het conceptvoorbeeld.

## Inhoud

- [`docs/concept.md`](docs/concept.md): besluiten, analyse van de Guindex-code, spelregels, geschiedenis per kroeg, ontwerp en datamodel.
- [`docs/kroegentocht.md`](docs/kroegentocht.md): idee voor een kroegentocht langs gekozen kroegen, met afstand en kcal (nog uit te werken).
- [`docs/toekomstplannen.md`](docs/toekomstplannen.md): ideeën voor later, zoals een prijs zonder alcohol en punten voor extra bier.
- [`docs/inloggen-met-apple-en-google.md`](docs/inloggen-met-apple-en-google.md): stappenplan om inloggen met Apple en Google aan te zetten.
- [`prototype/index.html`](prototype/index.html): klikbaar prototype v2 (iPhone eerst, Nijmegen). Open het bestand in een browser; er is geen build of server nodig.
- [`prototype/v1/index.html`](prototype/v1/index.html): eerste prototype.
- [`app/`](app/): de echte app (PWA) op Supabase: kaart van Nijmegen met kroegen uit OpenStreetMap, inloggen, prijzen melden en bevestigen, foto's, ranglijst en live updates.
- [`supabase/`](supabase/README.md): databaseschema, spelregels, Edge Function voor de kroegimport en installatiestappen.

Alle data in de prototypes is verzonnen. De kaart van Nijmegen is vereenvoudigd nagetekend.

## Wat je in prototype v2 kunt doen

- Kroegen onder de mist vrijspelen; de dichtstbijzijnde kroeg op slot staat bovenaan.
- Per kroeg de geschiedenis bekijken: eerst gemeld, wijzigingen en controles, met datum en naam. Bovenaan staat de stamgast: wie hier het vaakst de prijs bijwerkte of bevestigde.
- "Klopt nog" of "Prijs is anders" melden en zien hoe een andere speler je bevestigt.
- In het tabblad Samen de voortgang van de stad, weekdoelen, voortgang per wijk en recente activiteit bekijken.
- De ranglijst bekijken: wie draagt het meest bij.

Veroveringen (kroegbaas, wijkbezit) en teams staan uit. De code staat er nog in, achter `FEATURES` bovenaan het script in `prototype/index.html`.

## De app draaien

De app heeft geen build nodig. Lokaal:

```bash
python3 -m http.server 8765 --directory app
```

Open daarna http://localhost:8765. Eerst moet de backend klaarstaan: zie [`supabase/README.md`](supabase/README.md). De app draait online op https://bpdb-nl.pages.dev.

## Controleren

```bash
npm install
npm run check     # syntaxis van de app
npm run test:db   # schema en spelregels in een Postgres in het geheugen
```
