# BPDB-NL

Beer Price Database voor Nederland: een door gebruikers gevulde kaart met bierprijzen per kroeg. Iedereen speelt samen de hele stad vrij en houdt de prijzen vers. Pilotstad: Nijmegen. Guindex (guindex.ie) is het conceptvoorbeeld.

## Inhoud

- [`docs/concept.md`](docs/concept.md): besluiten, analyse van de Guindex-code, spelregels, geschiedenis per kroeg, ontwerp en datamodel.
- [`prototype/index.html`](prototype/index.html): klikbaar prototype v2 (iPhone eerst, Nijmegen). Open het bestand in een browser; er is geen build of server nodig.
- [`prototype/v1/index.html`](prototype/v1/index.html): eerste prototype.

Alle data in de prototypes is verzonnen. De kaart van Nijmegen is vereenvoudigd nagetekend.

## Wat je in prototype v2 kunt doen

- Kroegen onder de mist vrijspelen; de dichtstbijzijnde kroeg op slot staat bovenaan.
- Per kroeg de geschiedenis bekijken: eerst gemeld, wijzigingen en controles, met datum en naam.
- "Klopt nog" of "Prijs is anders" melden en zien hoe een andere speler je bevestigt.
- In het tabblad Samen de voortgang van de stad, weekdoelen, voortgang per wijk en recente activiteit bekijken.
- De ranglijst bekijken: wie draagt het meest bij.

Veroveringen (kroegbaas, wijkbezit) en teams staan uit. De code staat er nog in, achter `FEATURES` bovenaan het script in `prototype/index.html`.
