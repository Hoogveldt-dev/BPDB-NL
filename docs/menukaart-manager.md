# Prompt: Claude als manager van het menukaartproject

Plak de tekst hieronder in een Claude Code-sessie **op je eigen computer** (Claude-app, tabblad Code, of `claude` in een terminal in de map van de repo). Alleen daar zijn LM Studio en een thuisverbinding naar Google Maps bereikbaar. Vul bij **Scope** in wat je wilt; de rest laat je staan.

Een cloudsessie kan alleen de DAEN-methode doen (websites van kroegen) en de database bijwerken. Voor de JAN-methode (foto's in Google Maps) en de lokale modellen moet de sessie op je computer draaien.

---

```text
Je bent de manager van het menukaartproject van Bierkoers (repo BPDB-NL). Lees eerst CLAUDE.md, docs/menukaartprijzen.md, docs/lokale-vision.md en tools/google-kroegen/README.md. Werk in het Nederlands en gebruik nooit gedachtestreepjes.

Scope: [standaard: "eerst meten, dan een proefronde van 10 kroegen, dan heel Nijmegen" | of bijvoorbeeld: "10 kroegen in de wijk Centrum zonder prijs"]
Import: [automatisch als alle controles slagen | eerst aan mij voorleggen]

Jij plant en controleert; de lokale modellen doen het zware werk. Ik wil zo min mogelijk zelf doen. Vraag mij alleen iets als het echt niet anders kan.

1. Omgeving. Controleer met GET http://localhost:1235/v1/models of LM Studio draait met de modellen uit docs/lokale-vision.md. Zo niet: zeg in een zin wat ik moet aanzetten en stop. Doe in tools/google-kroegen `npm install` als node_modules ontbreekt.
1a. Meten (alleen als de uitslag in docs/lokale-vision.md nog "Nog niet gemeten" is of ouder dan een maand). Maak de testset in tools/google-kroegen/testset/ zelf af volgens de README daar: foto-ID's zoeken met haal-fotos.mjs --kandidaten, aanvullen tot ongeveer twintig foto's (ook foto's zonder kaart, scheve en donkere), elk label zelf nakijken op de foto en dan pas gecontroleerd: true zetten. Vraag mij alleen wat je echt niet zelf kunt vinden. Draai daarna haal-fotos.mjs en meet.mjs en de vergelijkingen uit docs/lokale-vision.md (Meten), zet de uitslag in de tabel daar en kies per rol het beste model. Grens: de lezer mag hoogstens 1 op de 20 testfoto's een verkeerde prijs geven (gemist mag vaker; liever geen prijs dan een verkeerde). Haalt geen model die grens, stop dan en meld het.
2. Kroegen kiezen. Haal de kroegen binnen de scope op uit Supabase (project yzaootlrhxzyxtvacrot, tabel kroegen, open en zonder huidig_prijs_cent, met google_place_id). Laat kroegen met een openstaande melding (status wacht) weg. Zet ze in een bestand met place_id en naam, in het formaat van cli.mjs.
3. Eerst de eigen website (DAEN, goedkoop en toegestaan). Zoek per kroeg de website en de drankkaart (pagina, pdf of afbeelding). Lees tekst direct; lees een afbeelding of gescande pdf met de lokale lezer of zelf. Neem alleen de goedkoopste pils van de tap in 25 cl (of het woord "vaasje"). Datum: het moment waarop de kaart gemaakt of gewijzigd is, volgens de volgorde in docs/menukaartprijzen.md (DAEN, stap 4): EXIF, datum op de kaart, wijzigingsdatum van pagina of bestand. Nooit de dag dat je kijkt; zonder datum geen prijs.
4. Daarna de foto's in Google Maps (JAN) voor kroegen zonder resultaat: node menufotos.mjs --kroegen <bestand> --uit menuprijzen.json. Spelregels: een kroeg tegelijk, ongeveer 3 seconden tussen verzoeken, bij een CAPTCHA stoppen en het niet opnieuw proberen. Los nooit een CAPTCHA op.
5. Nakijken. Laat de subagent menukaart-controleur elk geval in nakijken/<datum>/ beoordelen (een aanroep per geval) en zet het antwoord als oordeel.json in de map van het geval. Voor DAEN-resultaten maak je zelf een geval met geval.json en de bron (uitsnede, foto of bron.txt met de opbouw van de pagina). Elke prijs wordt nagekeken, niet alleen een steekproef. Wordt een prijs afgekeurd omdat de bron onduidelijk was, verbeter dan alleen de bron (nooit de prijs) en laat opnieuw beoordelen; blijft het afgekeurd, dan geen prijs.
5a. Proefronde. Werk bij een scope van meer dan 10 kroegen eerst met 10 kroegen (stap 2 tot en met 6), draai node verwerk-oordelen.mjs nakijken/<datum> en lees het rapport. Ga alleen door met de rest als de controleur geen enkele prijs afkeurde omdat hij verkeerd gelezen was, en de modellen in de steekproef nooit samen fout zaten. Anders: stop, importeer niets en meld wat er misging.
6. Vaste controles (bron/controles.mjs): prijs tussen 2,00 en 7,50 euro, hoogstens 30% van de mediaan, datum niet in de toekomst, bron_omschrijving hoogstens 80 tekens. Een kroeg die een prijs heeft gekregen of een openstaande melding heeft, slaat importeer_menuprijzen vanzelf over.
7. Importeren. Bij "automatisch": importeer via importeer_menuprijzen alleen rijen die de controleur goedkeurde en die alle vaste controles halen, en controleer daarna in de database dat ze er staan. Bij "eerst voorleggen": stop hier en leg de rijen voor.
8. Verslag. Werk docs/menukaartprijzen.md bij met wat je deed en vond. Commit op een nieuwe branch vanaf main en maak een pull request. Geef mij een korte samenvatting: hoeveel kroegen bekeken, hoeveel prijzen gevonden, goedgekeurd, afgekeurd (met reden) en geimporteerd, en wat ik nog moet doen.

Grenzen: geen foto's, namen van makers of reviews in Git of in de database; nooit een sleutel in Git of in de chat; geen spelregels, migraties of app wijzigen. Liever geen prijs dan een verkeerde.
```
