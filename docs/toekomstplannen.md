# Toekomstplannen

Ideeën die we bewust nog niet bouwen. Uitgewerkte concepten staan in een eigen document; hier staat de rest kort, met waarom het nog niet nu is.

## Een prijs zonder alcohol

Naast bier ook de prijs van iets zonder alcohol vastleggen, bijvoorbeeld een cola. Handig voor wie de BOB is, en het past bij "we belonen bijdragen, nooit drinken".

- Waarom nog niet: eerst moet het spel met de pils goed lopen. Elke extra soort betekent meer invullen.
- Hoe het kan: als vaste soort in `biersoorten` erbij (de tabel heet dan beter `soorten`), of als aparte lijst voor frisdrank. De extra's (`kroeg_aanbod`) kunnen het al bijna; alleen de naam en de lijst moeten mee.

## Punten voor extra bier

Extra bier bij een kroeg (Guinness, witbier, een ander merk pils) levert nu geen punten op. Daardoor is er geen reden om te sjoemelen en hoeft niemand het te bevestigen. BPDB is naast een spel ook een database, dus invullen moet wel kunnen, en dat kan.

- Later misschien een kleine beloning, bijvoorbeeld +2 punten.
- Dan moeten extra's wel bevestigd worden door een andere speler met e-mailadres (zoals bij de pils), anders kan iemand punten verdienen met verzonnen bier. Ook een maximum per dag of per kroeg ligt dan voor de hand.
- Waar het moet: `private.meld_aanbod` en `private.beoordeel_aanbod` in `supabase/migrations/20261106120000_extra_bier.sql` (via een nieuwe migratie), de puntentabel in `supabase/README.md` en de test.

## Betrouwbaarheid opnieuw bekijken

De betrouwbaarheid verandert sinds migratie `20261106220000_betrouwbaarheid_verwachting` naar verwachting (het idee van Elo): zie [concept.md](concept.md), 2.6. Dat staat erin als voorlopige oplossing; **Kjell is er nog niet tevreden over**. Bij een nieuwe versie: nieuwe migratie met `private.betrouwbaarheid_na` en eventueel `private.ervaren_melder`, de tabel in `supabase/README.md`, paragraaf 2.6 en de test.

## Eenvoudiger voor een eerste bezoeker

Opmerkingen uit een rondgang door de app (20 november 2026). Kjell wil ze bewaren, nog niet bouwen.

- **Twee soorten navigatie tegelijk.** Op de kaart staan Stad, Koers en Mijn kaart plus de Guinness-knop, in het blad staan Kaart, Beurs, Ranglijst en Ik. Een nieuwe gebruiker ziet zo zeven knoppen voordat hij iets heeft gedaan. Idee: Koers en Guinness achter een knop "Weergave".
- **Veel eigen begrippen.** Koers, Pilsindex, in kaart, vrijspelen, ontdekt en tickercodes zijn leuk zodra je het spel kent, maar veel voor een eerste bezoek. Een eerste bezoeker heeft eigenlijk maar een vraag: wat kost hier een biertje? Idee: de beurstaal pas tonen als iemand een keer heeft bijgedragen.

## Stadsfonds: je punten belegd in je stad

Concept (20 november 2026), nog niet bouwen. Het idee van Kjell: de punten die je verdient, worden vanzelf "belegd" in het fonds van je stad, en ze groeien mee met dat fonds. Wie in meerdere steden speelt, heeft een portefeuille met meerdere fondsen.

### Waarom het fonds niet aan de bierprijs hangt

Het eerste idee was: het fonds volgt de Pilsindex, dus je punten stijgen als bier duurder wordt. Dat doen we niet:

1. **De prikkel staat verkeerd om.** De Pilsindex is de middelste prijs van de kroegen die meetellen. Wie belang heeft bij een hoge index, meldt liever dure kroegen dan goedkope, of vult een prijs net te hoog in. Bevestigen helpt maar deels: ook eerlijke meldingen van alleen dure kroegen trekken de index omhoog. Dat ondermijnt waar de app om draait: kloppende prijzen.
2. **Het botst met het merk.** Bierkoers kijkt door de ogen van de klant: duurder is rood. Een spel waarin je wint als bier duurder wordt, keert dat om.
3. **Bierprijzen bewegen bijna niet.** Hooguit een stap per jaar, een paar procent. Het fonds zou maanden stilstaan, en als het beweegt, komt dat vooral doordat er kroegen in de index bijkomen of afvallen. Dat voelt willekeurig.
4. **De ranglijst wordt scheef.** Twee spelers die even hard werken, zouden anders scoren omdat hun stad duurder werd.

### Het fonds volgt hoe goed de stad in kaart is

De koers van een stadsfonds hangt af van hoeveel kroegen een bevestigde prijs hebben en hoe vers die prijzen zijn. Het stijgt dus doordat spelers bijdragen en controleren, en daalt als prijzen oud worden. Iedereen wil dan hetzelfde als de app, en samenspelen loont ("met z'n allen").

Per stad, met alleen open kroegen:

- **Dekking D** = kroegen met een bevestigde prijs / alle kroegen. Prijzen die nog op bevestiging wachten tellen niet mee (zo valt er niets te winnen met verzonnen meldingen), menukaartprijzen ook niet (anders springt het fonds bij elke import).
- **Versheid V** = het gemiddelde over de kroegen met een bevestigde prijs: gecontroleerd in de laatste 30 dagen telt 1, 30 tot 90 dagen telt 0,5, 90 dagen of ouder telt 0.
- **Gezondheid G** = D × (0,5 + 0,5 × V). Een getal van 0 tot 1: in kaart brengen weegt het zwaarst, versheid bepaalt hoeveel ervan overeind blijft.
- **Koers K** = 100 × (1 + G). Een lege stad staat op 100, een stad die helemaal in kaart en vers is op 200.

Door de verhouding (en niet het aantal kroegen) zijn kleine en grote steden te vergelijken.

### Je portefeuille

- Elke punt die je verdient bij een kroeg, koopt deelbewijzen in het fonds van die stad tegen de koers van dat moment: deelbewijzen = punten / K.
- De waarde van je portefeuille is per stad deelbewijzen × de koers van nu, opgeteld over je steden. Het verschil met je verdiende punten is je rendement.
- Wie vroeg bijdraagt, als een stad nog leeg is, koopt goedkoop in en wint het meest als de stad vol raakt. Dat beloont pioniers.
- Raken de prijzen in je stad verouderd, dan daalt je portefeuille. Dat is de reden om "klopt nog" te doen.

Rekenvoorbeeld voor Nijmegen. Vandaag hebben 2 van de 164 kroegen een bevestigde prijs, allebei vers: G = 0,012 en K = 101,2. Wie nu 100 punten verdient, krijgt 0,988 deelbewijs. Hebben later 82 kroegen een bevestigde prijs, de helft vers en de helft "wordt oud", dan is V = 0,75, G = 0,5 × 0,875 = 0,44 en K = 143,8. Die 100 punten zijn dan 142 waard: 42 procent rendement.

### Grenzen

- Het fonds hangt nooit af van de prijs zelf, alleen van dekking en versheid.
- Alleen spelpunten, geen geld: nooit uitbetalen, en in de app geen woorden die op echt beleggen lijken. Noem het "stadsfonds", niet "ETF" of "beleggen".
- We belonen bijdragen, nooit drinken: inchecken zonder prijs levert geen punten op en dus ook geen deelbewijzen.
- Wordt een melding weerlegd, dan gaan de punten eraf (die regels worden nu verwijderd, zie `20261113180000_punten_meteen.sql`). Staan de deelbewijzen op dezelfde regel, dan verdwijnen ze vanzelf mee.

### Weergave

- **Onder Ik: "Jouw portefeuille".** Per stad de verdiende punten, de waarde nu en het rendement, met een kleine grafiek van de fondskoers. Daaronder het totaal.
- **Op de Beurs:** een regel "Stadsfonds Nijmegen 101,2" bij "Samen in kaart". Het fonds is daar het gevolg van, niet iets nieuws om te leren.
- **Alleen voor wie heeft bijgedragen.** Dat past bij "Eenvoudiger voor een eerste bezoeker": geen extra beurstaal voor iemand die nog niets deed.
- **Eventueel koopkracht, alleen als weergave:** "Als je 1.200 punten euro's waren, kocht je er 308 vaasjes van in Nijmegen." Levert geen punten op, dus geen prikkel om prijzen te sturen.

### In fasen

1. **Alleen weergave, geen invloed op de ranglijst.** Zien of spelers het leuk vinden. De ranglijst blijft op punten.
2. **Daarna beslissen** of de waarde van de portefeuille meetelt, bijvoorbeeld als extra tabblad "Fondsen" naast Week, Maand en Altijd. De gewone puntentelling blijft dan bestaan.

### Waar het moet

- Een nieuwe migratie:
  - een functie `private.fonds_koers(gemeente)` die K uit `kroegen` berekent;
  - op `punten` de kolommen `gemeente` en `deelbewijzen`, gevuld door een trigger bij het invoegen (via gebeurtenis en kroeg naar de gemeente);
  - een tabel `fonds_dag` met de koers per stad per dag, gevuld door `pg_cron`, voor de grafiek;
  - een overzicht `mijn_portefeuille`.

  Bestaande punten krijgen deelbewijzen tegen koers 100, de startkoers: de spelers van het eerste uur waren pioniers.
- Spelregels in `supabase/README.md`, de test in `supabase/tests/database.test.mjs`, de weergave in `app/app.js` (Ik en Beurs) met de Engelse teksten in `app/en.js`, en een regel in `CLAUDE.md`. Dit verandert de spelregels, dus migratie, README en test samen.

### Open vragen voor Kjell

1. De weging: blijft het 50/50 tussen dekking en versheid binnen G, of moet versheid zwaarder tellen?
2. Tellen menukaartprijzen toch mee in de dekking (bijvoorbeeld voor de helft)?
3. Telt de waarde van de portefeuille ooit mee voor de ranglijst?
4. De naam: stadsfonds, kroegfonds of bierfonds?
5. Koopkracht tonen of niet?

## Meer beurs bij Bierkoers

De app heeft al een lichtkrant, tickercodes, het koersverschil per kroeg, de Pilsindex (vergeleken met twaalf maanden terug), langst prijsvast en dit jaar verhoogd, een koerskaart, wijken als sectoren en een trapje per rij. Alles daarvan wordt in de app berekend uit `kroeg_tijdlijn` (`koersen()` in `app/app.js`). Ideeën voor later:

- **Volglijst en koersalarm.** Volg kroegen (een eigen tabblad boven de lijst, naast Meest gemeld) en krijg een melding als een gevolgde kroeg de prijs verhoogt of als de index onder een bedrag zakt. Vraagt om pushmeldingen in de PWA en een tabel met gevolgde kroegen.
- **Weekbericht "Slotkoersen".** Elke maandag een korte samenvatting: index, grootste stijger en daler, wijk van de week. Als kaart om te delen of als mail (eigen SMTP nodig).
- **Index als view in de database.** Nu rekent de app de index uit. Met veel steden of veel geschiedenis is een view of een dagelijkse momentopname (`index_per_dag`) zuiniger, en dan kan de index ook in de lichtkrant van andere steden.
- **Steden als beurzen.** Zodra er meer steden zijn: een overzicht van alle stadsindexen naast elkaar, met de goedkoopste stad bovenaan.
- **Happy hour als koersdip.** Tijdelijke lagere prijzen tonen als dip in de grafiek. Vraagt om tijden bij een prijs; eerst kijken of spelers dat willen melden.
- Waarom nog niet: eerst moeten er genoeg echte koersen zijn. Met een handvol prijzen zegt een index weinig.

## Verder

- **Kroegentocht** met route, afstand en kcal: [kroegentocht.md](kroegentocht.md).
- **Captcha** bij anonieme accounts, en opruimen van oude anonieme accounts: zie `ACTIES.md`, Later.
