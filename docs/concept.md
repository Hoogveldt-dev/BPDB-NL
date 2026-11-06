# BPDB concept: Kroegkaart

Beer Price Database (BPDB) is een door gebruikers gevulde database van bierprijzen in Nederlandse kroegen. Guindex (guindex.ie, Ierland, alleen Guinness) dient als conceptvoorbeeld. Dit document is het levende concept; de geschiedenis staat in git.

Prototypes (open lokaal in een browser, geen build nodig):

- [`prototype/index.html`](../prototype/index.html): v2, iPhone-eerst, Nijmegen, samenwerken.
- [`prototype/v1/index.html`](../prototype/v1/index.html): v1, eerste opzet.

## 0. Besluiten

| Onderwerp | Besluit | Status |
|---|---|---|
| Kroegen vooraf op de kaart onder een mist, vrijspelen met een eerste prijs | Ja | Vast |
| Controle | Peer-to-peer bevestiging met betrouwbaarheidsscore; geen echte blockchain, geen tokens | Vast |
| Kroegen bevestigen zelf hun prijs | Niet in de basis; misschien later, altijd naast P2P | Later |
| Spelvorm | Samenwerken: iedereen speelt samen de hele stad vrij en houdt hem vers | Vast |
| Ranglijst | Blijft: laat zien wie het meest bijdraagt | Vast |
| Veroveringen (kroegbaas, wijkbezit) | Uitgeschakeld en uit de interface; code blijft achter een functievlag | Later |
| Teams | Uitgeschakeld; uitwerking staat in prototype v1 en hieronder | Later |
| Geschiedenis per kroeg | Ja: eerst gemeld, wijzigingen, controles, met datum en naam | Vast |
| Stamkroeg | Wie in een kroeg het vaakst de prijs bijwerkt of bevestigt, staat als stamgast bovenaan de geschiedenis | Vast |
| Inchecken en Mijn kroegen | Eigen kaart per speler naast de gezamenlijke: een kroeg gaat op jouw kaart open als je er incheckt. Privé, geen punten | Vast |
| Kroegentocht | Route langs de goedkoopste kroegen of langs kroegen waar je nog niet was; "beste" pas als er beoordelingen zijn | Eerste versie |
| Pilotstad | Nijmegen | Vast |
| Doelgroep ontwerp | iPhone eerst; strak, licht futuristisch, kaart in de stijl van Apple Kaarten | Vast |
| Code | Nieuw bouwen in deze repo; Guindex alleen als referentie | Vast |

## 1. Wat Guindex goed doet en waar het knelt

| Guindex | Probleem | BPDB |
|---|---|---|
| Gebruikers voegen zelf kroegen toe (`PubPendingCreate`) | Lege kaart bij de start, dubbele kroegen, typefouten | Alle kroegen vooraf geladen uit OpenStreetMap (`amenity=pub/bar/cafe`), getoond als "op slot" |
| Elke bijdrage wacht op goedkeuring door een beheerder (`*Pending*`-tabellen) | Beheerders zijn de bottleneck | Peer-bevestiging; beheerder alleen bij geschillen en uitschieters |
| Eén product, één maat (pint Guinness) | In NL verschillen merk en glas per kroeg | Prijs altijd met merk en volume; vergelijken via prijs per 25 cl |
| Statistiek per gebruiker: `pubsVisited`, `originalPrices`, `currentVerifications` | Een tabel, geen spel | Zelfde signalen als punten, titels en ranglijst |
| Bootstrap-adminthema, DataTables, Google Maps | Voelt als een beheerpaneel | Mobiel eerst, kaart als startscherm |

### 1.1 Is de Guindex-code bruikbaar?

Kort: als referentie wel, als basis niet. Bevindingen uit de repo:

- **Django 1.11.7** (sinds april 2020 niet meer ondersteund) en Django REST Framework 3.8. Code in Python 2-stijl (`__unicode__`, `MIDDLEWARE_CLASSES`, `from django.conf.urls import url`).
- **`django-rest-auth`** voor login: dit pakket wordt niet meer onderhouden.
- **Frontend**: ongeveer 3.600 regels jQuery met Bootstrap 4 (sb-admin-thema), DataTables en Google Maps. Geen componenten, geen build, niet mobiel-eerst.
- **Geen tests.**
- **Uitrol** via autotools, een RPM-pakket en systemd-units, plus een Telegram-bot en back-ups naar Dropbox.
- Omvang: ongeveer 4.700 regels Python (zonder migraties).

Upgraden betekent: Python 2 naar 3, Django 1.11 naar 5, rest-auth vervangen, de hele frontend opnieuw. Dat is in de praktijk een herbouw, maar dan met oude aannames (handmatige goedkeuring, één product). Advies: **opnieuw beginnen in deze repo** en uit Guindex alleen overnemen:

- het idee van een aparte tabel voor bijdragen naast de "huidige" prijs;
- de statistieken (goedkoopste, gemiddelden, bijdragen per gebruiker);
- de API-indeling (`/api/pubs`, `/api/prices`) als startpunt.

### 1.2 Voorgestelde techniek (nog te kiezen)

- **App**: eerst een PWA (installeerbaar op het iPhone-beginscherm, geen App Store nodig). Later eventueel native via Expo of Capacitor.
- **Kaart**: MapLibre GL met een eigen kaartstijl in de kleuren van Apple Kaarten, op gratis vectortegels (bijv. OpenFreeMap of Protomaps). Alternatief: MapKit JS, dat is echt Apple Kaarten op het web, maar vraagt een Apple Developer-account (99 dollar per jaar) en heeft een gebruikslimiet.
- **Backend**: Postgres met PostGIS (afstanden, wijken), bijvoorbeeld via Supabase: database, inloggen en toegangsregels in één.
- **Kroegdata**: eenmalige import uit OpenStreetMap voor Nijmegen, daarna periodiek bijwerken.

## 2. Gamification

De eerste versie draait om een **groepsprestatie**: iedereen werkt samen om Nijmegen volledig vrij te spelen en up-to-date te houden. Er valt niets te veroveren. De ranglijst blijft, als erkenning voor wie het meest bijdraagt.

### 2.0 Samen (vast)

Tabblad "Samen" in de app:

- **Stadsvoortgang**: een grote ring met het percentage vrijgespeelde kroegen en mijlpalen bij 25, 50, 75 en 100%. "Nog 15 kroegen tot de mijlpaal van 100%."
- **Weekdoelen voor iedereen**: aantal bijdragen van alle spelers samen, aantal oude prijzen (90+ dagen) dat nog ververst moet worden, en het percentage verse prijzen.
- **Per wijk**: voortgang en versheid per wijk, als gezamenlijk doel, zonder eigenaar.
- **Recent in de stad**: wie wat vrijspeelde, wijzigde of controleerde.
- **Op de kroegpagina**: wie de kroeg ontdekte en hoeveel spelers de prijs samen bijhielden.
- **Bevestigingsmelding**: "Nijmegen is nu samen 77% vrijgespeeld."

Nieuw in de puntentabel: **oude prijs controleren** (+15) voor prijzen van 90 dagen of ouder. Dat vervangt "vrije titel pakken" en houdt de stad vers zonder dat iemand iets afpakt.

### Functievlaggen

In `prototype/index.html` staat bovenaan het script:

```js
const FEATURES = { veroveringen: false, teams: false };
```

Met `veroveringen: true` komen kroegbaas-titels, wijkbezit, de wijkenlaag op de kaart en het oude tabblad "Spel" (met aan/uit-schakelaars) terug. De code daarvoor (`baasHtml`, `spelView`, `drawWijken`, `deriveBaas`) staat er nog in. Teams zijn uitgewerkt in [`prototype/v1`](../prototype/v1/index.html); in de echte app komen ze achter dezelfde soort vlag.

### 2.1 De mist (vast)

Elke kroeg uit OpenStreetMap staat op de kaart, maar onder een stippenraster. Wie als eerste een prijs invult, speelt de kroeg vrij: de mist trekt daar weg en je naam blijft als ontdekker bij de kroeg staan. Zo zie je in één oogopslag waar nog data ontbreekt.

### 2.2 Kroegbaas (uitgeschakeld, voor later)

- **Wie**: de melder van de laatste bevestigde *prijswijziging*.
- **Houden**: zolang de prijs gelijk blijft *en* de kroegbaas de kroeg zelf minstens eens per 90 dagen controleert.
- **Kwijtraken**: (a) iemand anders meldt een bevestigde prijswijziging, of (b) de kroegbaas heeft 90 dagen zelf niet gecheckt. In geval (b) komt de titel vrij voor wie hem als eerste weer checkt.

**Moet een kroegbaas zijn titel kwijtraken als de prijs niet verandert?** Ja, maar alleen door eigen inactiviteit, nooit doordat een ander op "klopt nog" tikt. Redenen:

1. Zonder verloop blijven titels voor altijd bij spelers die allang gestopt zijn. Nieuwe spelers zien dan een kaart vol kronen van mensen die er niet meer zijn.
2. Juist kroegen met een stabiele prijs raken zo toch gecontroleerd: de kroegbaas heeft een reden om terug te komen ("je titel verloopt over 9 dagen").
3. Als een check door een ander de titel zou verlengen, hoeft de kroegbaas zelf niets te doen. Als een check door een ander de titel zou *afpakken*, krijg je sniping. De eigen-check-regel vermijdt beide.

Staat uit; terug te zetten met de functievlag `veroveringen`.

### 2.3 Wijkbezit (uitgeschakeld, voor later)

Wie de meeste kroegbaas-titels in een wijk heeft, beheerst die wijk. Werkt alleen samen met kroegbaas-titels. In de samenwerkversie tonen wijken alleen gezamenlijke voortgang.

### 2.4 Teams (later)

Teams zijn groepen spelers die samen punten en titels verzamelen, bijvoorbeeld een studentenvereniging, sportclub of vriendengroep. Wijken worden dan door een team beheerst in plaats van door één persoon. Dit kan helpen om veel mensen tegelijk aan de slag te krijgen (Nijmegen heeft veel studentenverenigingen), maar het voegt regels toe. Daarom pas na de pilot.

### 2.5 Puntentabel

| Actie | Punten | Voorwaarde |
|---|---:|---|
| Kroeg vrijspelen (eerste prijs) | +50 | Ontdekker-badge blijft permanent |
| Prijswijziging melden | +30 | Pas na bevestiging (met veroveringen: maakt je kroegbaas) |
| Oude prijs controleren | +15 | Prijs is 90 dagen of ouder |
| Vrije titel pakken (alleen met veroveringen) | +25 | Kroegbaas checkte 90 dagen niet zelf |
| "Klopt nog" | +5 | Max. 1 keer per kroeg per 7 dagen |
| Ter plaatse (binnen 75 m) | x1,5 | Automatisch via locatie |
| Foto van de prijslijst | +5 | Optioneel |
| Bijdrage weerlegd | -20 | Plus daling betrouwbaarheid |

Punten worden pas uitgekeerd na bevestiging door een andere speler.

### 2.6 Peer-to-peer bevestiging

- Elke speler heeft een **betrouwbaarheid** (0 tot 100%), los van punten. Die stijgt als je bijdragen later door anderen bevestigd worden en daalt als ze worden weerlegd.
- Een prijs is **bevestigd** na twee onafhankelijke bronnen, of één bron met een betrouwbaarheid boven 90%.
- **Uitschieters** (ver van de mediaan voor dat merk en volume) hebben altijd twee bevestigingen nodig.
- Beheerders zien alleen geschillen en meldingen.

### 2.7 Inchecken en Mijn kroegen

Naast het gezamenlijke spel heeft elke speler een **eigen kaart**: de kroegen waar je zelf bent geweest. Vergelijk het met de reisstatistieken in Polarsteps: niet wat de groep heeft vrijgespeeld, maar wat jij hebt gezien. Het woord in de app is **inchecken**.

| Regel | Uitwerking |
|---|---|
| Hoe | In een kroeg op "Inchecken" tikken. Een prijs melden of "Klopt nog" ter plaatse telt automatisch ook als check-in |
| Ter plaatse | Alleen binnen 75 m van de kroeg, dezelfde grens als "ter plaatse" bij melden |
| Hoe vaak | Hoogstens een keer per kroeg per dag; elke dag telt als bezoek |
| Punten | Geen. We belonen bijdragen, nooit kroegbezoek of drinken (Reclamecode). Zo is er ook geen reden om je locatie te vervalsen |
| Privacy | Check-ins zijn locatiegeschiedenis. Alleen jij ziet ze; ze staan niet op de ranglijst of bij de stamgast. Je kunt ze zelf allemaal wissen |
| Los van de mist | Inchecken speelt een kroeg niet vrij voor de groep. Op jouw kaart is de kroeg open, ook als hij in het gezamenlijke spel nog onder de mist ligt |

**Op de kaart** wissel je bovenin tussen *Samen* (kleur is versheid) en *Mijn kaart* (goud waar je was, grijs waar je nog niet was). De ring toont dan hoeveel procent van de kroegen in de stad jij hebt bezocht.

**Mijn kroegen** (tabblad Ik), naar het voorbeeld van Polarsteps:

| Polarsteps | Kroegkaart |
|---|---|
| Je hebt gezien: 29 landen, 15% van de wereld | Aantal kroegen en percentage van de stad |
| Continenten bezocht | Wijken bezocht, met per wijk bezocht/totaal |
| Verzamelde vlaggen | Verzamelde kroegen als munten, met het aantal bezoeken |
| Alle stats | Check-ins, wijken, gemiddelde prijs per 25 cl van jouw kroegen tegenover de stad, eerste check-in, vaste stek, goedkoopste kroeg waar je was |
| Wanneer is je volgende avontuur? | Laatste check-in, hoeveel kroegen je nog niet hebt gezien, de dichtstbijzijnde nieuwe kroegen en een knop om een tocht te plannen |

Bewust weggelaten: "verste plek van huis" (we kennen geen thuisadres en vragen het ook niet) en een teller van dagen in de kroeg.

### 2.8 Kroegentocht

Een speler kan een tocht plannen vanaf zijn locatie (of het centrum), langs 3 tot 6 kroegen binnen 2 km:

- **Goedkoopst**: de kroegen met de laagste prijs per 25 cl.
- **Nog niet bezocht**: de dichtstbijzijnde kroegen waar je nog niet bent ingecheckt. Zo groeit je eigen kaart.

De volgorde is steeds de dichtstbijzijnde volgende kroeg; de route staat genummerd op de kaart. Afstanden zijn hemelsbreed. De planner zegt erbij: "Geniet, maar drink met mate: inchecken kan ook met een fris."

Later: tochten langs de **beste** kroegen (vraagt beoordelingen, die er nog niet zijn), tochten delen met vrienden, en een echte looproute.

### 2.9 Wat we niet doen

Geen tokens, geen virtueel vastgoed (Upland/Earth2), geen eigen blockchain. Echt geld trekt speculanten aan, valt onder MiCA en mogelijk de Kansspelautoriteit, en een onveranderlijk grootboek botst met foutcorrectie en de AVG. We belonen bijdragen, nooit drinken (Reclamecode voor Alcoholhoudende dranken). Alleen voor 18+.

## 3. Geschiedenis per kroeg

Elke kroeg toont een tijdlijn, nieuwste bovenaan:

- **Eerst gemeld**: prijs, datum, door wie, bevestigd door wie.
- **Gewijzigd**: oude prijs, nieuwe prijs, datum, door wie, bevestigd door wie.
- **Gecontroleerd**: "klopt nog", datum, door wie.

Daarnaast een grafiek van de prijs per 25 cl over het afgelopen jaar, met de mediaan van de stad als stippellijn. De tijdlijn komt direct uit het audit-log (zie datamodel); er is geen aparte opslag voor nodig.

### 3.1 Stamkroeg

Bovenaan de geschiedenis staat de **stamgast**: de speler die in deze kroeg het vaakst de gegevens heeft bijgewerkt of bevestigd. Zo is een kroeg niet alleen van wie hem ontdekte, maar ook van wie hem bijhoudt. Het past bij samenwerken: je wint de titel door de prijs vers te houden, niet door iemand te verdrijven.

| Regel | Uitwerking |
|---|---|
| Wat telt | Eigen meldingen die bevestigd zijn (eerst gemeld, gewijzigd, "klopt nog") en jouw "klopt" op een melding van een ander die daarna bevestigd is |
| Wat niet telt | Openstaande en weerlegde meldingen, en "klopt" op een melding die weerlegd werd |
| Drempel | Stamgast vanaf 2 bijdragen; een enkele melding maakt nog geen vaste gast |
| Gelijkspel | Wie de stand het eerst bereikte, blijft stamgast; inhalen kan alleen met een bijdrage meer |
| Wat je ziet | Naam en aantal bijdragen van de stamgast. Ben jij het niet, dan zie je hoeveel bijdragen je nog nodig hebt. Is er nog niemand, dan zie je hoe je de eerste wordt |

"Klopt nog" kan hoogstens een keer per week per kroeg, en meldingen tellen pas na bevestiging door een ander. Stamgast word je dus door er echt vaker te komen, niet door snel achter elkaar te tikken. De titel levert geen punten op; hij is erkenning.

In de database is dit de view `kroeg_stamgast` (op basis van `kroeg_bijdragers`), een query op `gebeurtenissen` en `bevestigingen` zonder aparte opslag.

## 4. Ontwerp v2

- **iPhone eerst.** Kaart over het hele scherm. Een glazen sheet onderin met drie standen (laag, half, vol), zoals in Kaarten op iOS. Zoekveld bovenaan in de sheet. Systeemlettertype (SF Pro) en iOS-kleuren voor groen, oranje en rood.
- **Kaart in de stijl van Apple Kaarten.** Lichte zandkleur voor land, witte straten, gele hoofdwegen over de bruggen, blauw water, groene parken. In het donker de donkere variant. In het prototype is de kaart van Nijmegen vereenvoudigd nagetekend; in de app komt hier een echte kaart.
- **Licht futuristisch.** De mist is een fijn stippenraster dat wegtrekt bij het vrijspelen, met een ring die uitdijt vanaf de kroeg. Verder rustig: glas, haarlijnen, geen neon of paarse verlopen.
- **Prijsspelden** met vaste grootte, zoals in Kaarten. Ingezoomd zie je de prijs per 25 cl; uitgezoomd of bij overlap een gekleurde stip. Gouden speld met kroon is jouw titel; een lege kroon betekent dat de titel vrij is.
- **Kleur is versheid.** Groen tot 30 dagen, oranje tot 90, rood daarna.
- **Op groot scherm** wordt de sheet een zijbalk links.

## 5. Datamodel (schets)

```
Kroeg        id, osm_id, naam, adres, lat, lon, wijk_id, open, ontdekker_id, kroegbaas_id, kroegbaas_sinds
Gebeurtenis  id, kroeg_id, soort (eerst/wijziging/check), merk, volume_cl, prijs_cent, door_id, op, ter_plaatse, foto_url, status (wacht/bevestigd/weerlegd)
Bevestiging  id, gebeurtenis_id, door_id, oordeel (klopt/klopt_niet), gewicht, op
Gebruiker    id, naam, punten, betrouwbaarheid
Inchecking   id, gebruiker_id, kroeg_id, op, dag, afstand_m, bron (inchecken/melding/controle)   (privé, een per kroeg per dag)
Punten       id, gebruiker_id, reden, punten, gebeurtenis_id, op       (audit-log; ranglijsten zijn queries hierop)
Wijk         id, cbs_code, naam, geometrie
```

"Laatste eigen check van de kroegbaas" is een query op `Gebeurtenis` (`door_id = kroegbaas_id`), geen apart veld.

## 6. Open vragen

1. Welke techniek precies (zie 1.2)? Te beslissen voor de eerste sprint.
2. Wanneer zetten we veroveringen of teams weer aan, en op basis van welk signaal (bijv. na 100% vrijgespeeld)?
3. Welke kroegsoorten tellen mee (alleen cafés en bars, of ook restaurants met een tap)?
4. Wat is een "beste" kroeg voor de kroegentocht: beoordelingen door spelers, versheid van de prijs, of het aantal stamgasten?
5. Mag een speler zijn aantal bezochte kroegen ooit openbaar maken (bijvoorbeeld op de ranglijst), en zo ja alleen met eigen toestemming?
