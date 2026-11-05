# Concept: kroegentocht

Status: idee, nog niet uitgewerkt en nog niet gebouwd. Dit stuk legt vast wat er bedacht is en welke vragen open staan.

## Het idee

De app stelt een wandelroute samen langs een paar kroegen en begeleidt je onderweg. Je kiest waarop de kroegen worden gekozen, bijvoorbeeld:

- **Goedkoopst:** laagste prijs per 25 cl (staat al in `kroeg_kaart.per25_cent`).
- **Best beoordeeld:** de hoogste waardering. BPDB heeft nog geen beoordelingen van kroegen; dat moet er dan eerst bij (zie Open vragen).
- **Eigen keuze:** je tikt zelf kroegen aan, de app bepaalt de handigste volgorde.
- **Anderszins**, bijvoorbeeld: alle kroegen in een wijk, kroegen die nog onder de mist liggen, of kroegen met een oude prijs.

Een grappige toevoeging is een **stappenteller met verbrande kcal**, juist omdat er in bier veel kcal zitten.

## Past het bij BPDB?

Ja, als de tocht het spel helpt en niet het drinken.

- **Tocht als controleronde.** Een route langs kroegen onder de mist of met oude prijzen helpt de stad vrij te spelen en vers te houden. Onderweg meld je ter plaatse prijzen (binnen 75 m, x1,5 punten). Dat is precies wat BPDB wil belonen.
- **We belonen bijdragen, nooit drinken** (docs/concept.md, 2.7, en de Reclamecode voor Alcoholhoudende dranken). Dus geen punten of badges voor het aantal kroegen, glazen of een snelle tocht; wel voor gemelde en gecontroleerde prijzen, zoals nu.
- **Alleen 18+**, zoals de rest van de app.

## Stappen en kcal

- **Een PWA kan geen stappen tellen.** Browsers hebben geen stappenteller. De app kan wel de gelopen afstand meten met de locatie (`watchPosition`), maar alleen zolang de app open en op het scherm staat; op een iPhone stopt dat op de achtergrond. Alternatief: de afstand van de geplande route gebruiken.
- **Schatting:** wandelen kost ongeveer 0,5 tot 0,7 kcal per kg lichaamsgewicht per km; voor iemand van 70 kg zo'n 40 tot 50 kcal per km. Een vaasje pils (25 cl, 5%) bevat ongeveer 100 kcal. "Eén vaasje is ongeveer 2 km lopen" is dus een leuke vergelijking. Deze getallen moeten voor gebruik nog worden gecontroleerd.
- **Toon.** Speels, maar niet als aansporing om te drinken of als "verdiend biertje". Mogelijk ook een knipoog de andere kant op ("Wissel af met water"). Toets de teksten aan de Reclamecode.
- **Privacy.** Locatie en afstand van de tocht blijven op de telefoon, zoals de stappen in Woober Fit. Alleen gemelde prijzen gaan naar de database, zoals nu.
- **Later native.** Wordt BPDB een app in de App Store en Google Play, dan kan een echte stappenteller (zoals `src/components/Stappenteller.tsx` en `src/lib/stappen.ts` in Woober).

## Techniek (eerste schets)

- **Volgorde:** voor een handvol kroegen volstaat dichtstbijzijnde eerst, met een korte verbeterstap (2-opt). Dat kan gewoon in de browser.
- **Looproute:** eerst rechte lijnen op de kaart (MapLibre staat er al). Echte looproutes vragen een routedienst (bijvoorbeeld openrouteservice of GraphHopper, met een sleutel), of een eigen OSRM-server.
- **Database:** voor een tocht alleen is niets nieuws nodig; kroegen en prijzen staan er al. Tochten opslaan of delen met vrienden vraagt een tabel `tochten` met RLS.
- **Start en einde:** vanaf je huidige locatie of een gekozen punt; afstand en aantal stops instelbaar, met een bovengrens.

## Open vragen

1. Komen er beoordelingen van kroegen (sfeer, bediening), en zo ja hoe voorkomen we nepbeoordelingen? Bijvoorbeeld alleen ter plaatse en alleen met gekoppeld e-mailadres, net als bevestigen.
2. Samen een tocht lopen: een groep met een gedeelde route en samen punten?
3. Hoe meten we afstand zonder de batterij leeg te trekken, en wat doen we als de app op de achtergrond staat?
4. Welke routedienst, en wat kost die?
5. Hoe houden we de toon verantwoord (Reclamecode, 18+, geen beloning voor drinken), en wie toetst de teksten?
6. Moet een tocht ook zonder account kunnen (als kaartfunctie), of alleen voor spelers?
