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
