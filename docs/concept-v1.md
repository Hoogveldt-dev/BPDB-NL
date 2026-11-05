# BPDB concept v1: Kroegkaart

Beer Price Database (BPDB) is een door gebruikers gevulde database van bierprijzen in Nederlandse kroegen. Guindex (guindex.ie, Ierland, alleen Guinness) dient als conceptvoorbeeld. Dit document beschrijft wat we van Guindex overnemen, wat we anders doen, en of gamification een goed idee is.

Klikbaar prototype: [`prototype/index.html`](../prototype/index.html) (open lokaal in een browser, geen build nodig).

## 1. Wat Guindex goed doet en waar het knelt

| Guindex | Probleem | BPDB v1 |
|---|---|---|
| Gebruikers voegen zelf kroegen toe (`PubPendingCreate`) | Lege kaart bij de start, dubbele kroegen, typefouten | Alle kroegen vooraf geladen uit OpenStreetMap (`amenity=pub/bar/cafe`), getoond als "op slot" |
| Elke bijdrage wacht op goedkeuring door een beheerder (`*Pending*`-tabellen, e-mailalerts) | Schaalt niet: beheerders zijn de bottleneck | Peer-bevestiging met betrouwbaarheidsscore; beheerder alleen bij geschillen en uitschieters |
| Eén product, één maat (pint Guinness) | In NL verschillen merk en glas per kroeg (fluitje, vaasje, 33 cl, halve liter) | Prijs altijd met merk en volume; vergelijken via genormaliseerde prijs per 25 cl |
| Statistiek per gebruiker: `pubsVisited`, `originalPrices`, `currentVerifications` | Bestaat al, maar is een tabel zonder spel | Zelfde signalen, nu als punten, titels en ranglijsten |
| Bootstrap-adminthema (sb-admin), DataTables, Google Maps | Voelt als een beheerpaneel, niet als een app | Mobiel eerst: kaart als startscherm, invullen in drie tikken |
| Sterrenbeoordeling van de pint | Subjectief, weinig gebruikt | Weggelaten in v1 (kan later terug) |

## 2. Is gamification een goed plan?

**Kort antwoord: ja voor vrijspelen, ranglijsten en kroegen veroveren. Nee voor een Upland/Earth2-achtig systeem of blockchain.**

### 2.1 Waarom wel

Een crowdsourced prijzendatabase heeft drie kernproblemen. Gamification raakt er twee direct:

1. **Koude start.** Een lege kaart nodigt niet uit. Een kaart vol kroegen "op slot" wel: elke grijze speld is een open opdracht. Dit is het mechanisme van fog of war en werkt omdat het de ontbrekende data zichtbaar maakt in plaats van te verbergen.
2. **Versheid.** Prijzen veranderen (vaak rond 1 januari en na accijnsverhogingen). De waardevolste bijdrage is niet de eerste prijs maar de melding dat een prijs veranderd is. Een titel die je verdient door een prijswijziging te melden, en die een ander van je kan afpakken, beloont precies dat gedrag.
3. **Betrouwbaarheid.** Dit lost gamification niet op, het maakt het juist erger (meer prikkel om te sjoemelen). Daarom moet het puntensysteem gekoppeld zijn aan bevestiging door anderen (zie 2.4).

Bewezen voorbeelden: Foursquare/Swarm (burgemeester van een locatie), Waze (rangen en punten voor meldingen), OpenStreetMap-projecten zoals StreetComplete (quests op de kaart), Google Local Guides (niveaus). Allemaal zonder echt geld.

### 2.2 Het veroveringsspel: welke regel?

Het idee "meest recente bijdrage sinds een prijsverandering" heeft een valkuil. Als gewoon de laatste bevestiging de kroeg wint, gaan spelers snipen: elke dag op "klopt nog" tikken, ook zonder te kijken. Dat levert ruis op, geen informatie.

Voorstel voor v1:

- **Kroegbaas** = degene die de laatste bevestigde *prijswijziging* meldde. Je houdt de titel zolang de prijs gelijk blijft.
- Een wijziging telt pas na bevestiging door een tweede, onafhankelijke speler (of één speler met hoge betrouwbaarheid). Een valse wijziging kost punten en betrouwbaarheid.
- **Heroveren**: als niemand een kroeg 90 dagen heeft gecontroleerd, wordt de titel vrijgegeven. De eerste die dan een bevestigde check doet (gewijzigd of niet) wordt kroegbaas. Zo blijven ook stabiele kroegen in beweging zonder sniping.
- **Wijken**: de speler (of het team) met de meeste kroegbaas-titels in een CBS-wijk beheerst die wijk. Dit geeft een Risk-achtige laag zonder extra regels.
- **Teams** (studentenverenigingen, sportclubs, vriendengroepen) zijn in NL een sterke motor. Teams strijden om wijken.

### 2.3 Puntentabel v1

| Actie | Punten | Voorwaarde |
|---|---:|---|
| Kroeg vrijspelen (eerste prijs) | +50 | Ontdekker-badge blijft permanent op de kroeg |
| Prijswijziging melden | +30 | Pas na bevestiging; maakt je kroegbaas |
| Kroeg heroveren (>90 dagen niet gecontroleerd) | +25 | Bevestigde check |
| "Klopt nog" bevestigen | +5 | Max. 1x per kroeg per 7 dagen |
| Ter plaatse (binnen 75 m) | x1,5 | Locatie optioneel, niet verplicht |
| Foto van de prijslijst | +5 | Optioneel, versnelt bevestiging |
| Bijdrage afgewezen door anderen | -20 | Plus daling betrouwbaarheid |

Ranglijsten per stad en per periode (week, maand, altijd), zodat nieuwkomers kans maken.

### 2.4 Peer-bevestiging in plaats van beheerders

Dit is het deel van het "blockchain-achtige" idee dat wél waarde heeft: consensus. Alleen heb je daar geen blockchain voor nodig.

- Elke gebruiker heeft een **betrouwbaarheid** (0 tot 100%), los van punten. Die stijgt als je bijdragen later door anderen bevestigd worden en daalt als ze worden weerlegd.
- Een prijs is **bevestigd** als het gewogen gewicht van onafhankelijke bronnen een drempel haalt (bijvoorbeeld twee gewone spelers, of één speler boven 90%).
- **Uitschieters** (prijs meer dan 3 standaarddeviaties van de stadsmediaan voor dat merk en volume) hebben altijd twee bevestigingen nodig.
- Beheerders zien alleen geschillen en meldingen, niet elke invoer.
- Punten voor bevestigen worden pas uitgekeerd als jouw bevestiging met de uiteindelijke consensus overeenkomt. Blind op "klopt nog" tikken is dus niet lonend.

### 2.5 Waarom geen Upland/Earth2 of blockchain

1. **Echt geld trekt de verkeerde spelers aan.** Zodra kroegen virtueel eigendom met handelswaarde worden, gaat het om speculeren en niet meer om bierprijzen. Earth2 laat zien hoe snel zo'n model om de waarde van grond draait en niet om het gebruik.
2. **Juridisch zwaar.** Verhandelbare tokens vallen al snel onder MiCA (EU-cryptoregels) en mogelijk onder de Kansspelautoriteit. Dat is een vergunningstraject, geen hobbyproject.
3. **Onveranderlijkheid werkt tegen je.** Foute prijzen moeten corrigeerbaar zijn en de AVG geeft gebruikers recht op verwijdering. Een append-only ledger maakt beide moeilijk.
4. **Het lost geen echt probleem op.** Blockchain helpt als partijen elkaar niet vertrouwen en er geen centrale beheerder is. BPDB heeft gewoon een beheerder. Een database met een audit-log (wie wijzigde wat, wanneer) geeft dezelfde transparantie.
5. **Beloningen in geld of bier botsen met alcoholregels.** De Reclamecode voor Alcoholhoudende dranken verbiedt aansporen tot overmatig drinken. Beloon daarom bijdragen, nooit consumptie. Geen opdrachten als "bezoek 10 kroegen vanavond". Een prijs aflezen kan zonder iets te bestellen. 18+-check bij registratie.

Als je later toch tastbare beloningen wilt: niet-alcoholisch en buiten de app om (merchandise, een jaarlijkse prijs voor de beste kroegbaas per stad), of samenwerkingen met kroegen die zelf hun prijs bevestigen.

## 3. Ontwerpprincipes v1

- **Kaart is het startscherm.** Kroegen op slot zijn grijs onder een mist; vrijgespeelde kroegen maken een gat in de mist. De voortgang van de stad staat bovenaan.
- **Kleur = versheid.** Groen tot 30 dagen, oranje tot 90 dagen, rood daarna (heroverbaar). Zo zie je in één oogopslag waar werk ligt.
- **Invullen in drie tikken.** Merk, glas, prijs. Locatie en foto optioneel.
- **Genormaliseerde prijs.** Op de kaart staat de prijs per 25 cl, zodat een fluitje en een halve liter vergelijkbaar zijn. In het detail staat de echte prijs en het echte glas.
- **Status van een prijs is altijd zichtbaar.** Onbevestigd, bevestigd of betwist.
- **Donker als basis.** Kroegen bezoek je 's avonds; de kaart is donker en licht ook goed leesbaar.

## 4. Datamodel v1 (schets)

```
Kroeg          id, osm_id, naam, adres, lat, lon, wijk_id, status (open/dicht), kroegbaas_id, ontdekker_id, laatst_gecontroleerd
Prijs          id, kroeg_id, merk, volume_cl, prijs_cent, ingediend_door, ingediend_op, ter_plaatse, foto_url, status (onbevestigd/bevestigd/betwist)
Bevestiging    id, prijs_id, gebruiker_id, oordeel (klopt/klopt_niet), gewicht, op
Gebruiker      id, naam, team_id, punten, betrouwbaarheid
Puntenmutatie  id, gebruiker_id, reden, punten, prijs_id, op   (audit-log, ranglijsten zijn hier queries op)
Wijk           id, cbs_code, naam, geometrie
Team           id, naam
```

## 5. Openstaande keuzes

1. Techniek: Guindex herbruiken (Django) of opnieuw (bijv. Supabase + een webapp)? Advies: opnieuw, maar het API-ontwerp van Guindex (`/api/pubs`, `/api/guinness`) als uitgangspunt.
2. Startstad voor de pilot (één stad, zodat de kaart snel vol raakt).
3. Moet een kroeg zelf zijn prijs kunnen bevestigen (geverifieerd-vinkje)?
4. Teams vanaf dag één of pas in v2?
