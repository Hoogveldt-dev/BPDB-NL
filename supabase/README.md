# Supabase-backend van BPDB

Alles wat in de database en bij Supabase draait, staat in deze map.

| Onderdeel | Bestand | Wat het doet |
|---|---|---|
| Schema en spelregels | `migrations/20261105180124_kroegkaart_schema.sql` | Tabellen, toegangsregels (RLS), punten, peer-bevestiging, overzichten, realtime, opslag voor foto's |
| Anonieme spelers | `migrations/20261106090000_anonieme_spelers.sql` | Meteen meespelen zonder e-mailadres; bevestigen alleen met e-mailadres |
| Willekeurige spelersnaam | `migrations/20261110120000_willekeurige_spelersnaam.sql` | Anonieme spelers en spelers zonder naam krijgen een naam als `dorstige-zebra` (`private.willekeurige_naam()`); een eigen naam pas na het koppelen van een e-mailadres |
| Betrouwbaarheid naar verwachting | `migrations/20261106220000_betrouwbaarheid_verwachting.sql` | Voorlopig, nog niet definitief. Hoe verrassender de uitkomst, hoe groter de sprong; boven 90% pas met ervaring |
| Bevestigen naar betrouwbaarheid | `migrations/20261106150000_bevestigen_naar_betrouwbaarheid.sql` | Melder boven 90%: een andere speler; anderen: twee. Geen automatische bevestiging meer. `kroeg_kaart` toont de wachtende prijs |
| Extra bier | `migrations/20261106120000_extra_bier.sql` | Wat een kroeg naast de pils tapt (Guinness, witbier, ander merk), met of zonder prijs; geen punten |
| Stamkroeg | `migrations/20261105220601_stamkroeg.sql`, `migrations/20261125220000_stamgast_per_dag.sql` | Overzichten `kroeg_bijdragers` en `kroeg_stamgast`: wie per kroeg op de meeste dagen bijwerkt of bevestigt |
| Inchecken | `migrations/20261106210000_inchecken.sql` | Tabel `incheckingen`, functie `inchecken`, overzicht `mijn_kroegen`: de eigen kaart van elke speler |
| Kroegimport | `../app/overpass.js`, `functions/osm-import/index.ts`, `functions/osm-import/verwerk.ts`, `functions/osm-import/grenzen.ts` | Kroegen uit OpenStreetMap voor een gemeente uit `gemeenten`. De browser van de beheerder haalt ze op bij Overpass (`app/overpass.js`: overpass-api.de, met mail.ru en kumi.systems als reserve, twee rondes), gezocht op code (`ref:gemeentecode` in Nederland, `ref:INS` in België); vanuit Supabase is Overpass niet betrouwbaar bereikbaar (overpass-api.de weigert de servers van Supabase). De Edge Function `osm-import` verwerkt het antwoord (`verwerk.ts`) en bewaart het. In België telt ook een `amenity=cafe` als kroeg als niets op een koffiezaak wijst (geen keten, winkel, eet- of koffiekeuken of koffienaam) en hij na 22:00 open is, of zonder openingstijden een kroegnaam heeft ('t Vosken, Herberg, Sportbar). Wijken zijn het lokale equivalent: in Nederland van het CBS (PDOK); in een Belgische stad met een eigen wijkindeling die indeling (`LOKALE_WIJKEN` in `verwerk.ts`: Gent, 25 stadswijken van data.stad.gent, Modellicentie Gratis Hergebruik); anders de deelgemeenten uit OpenStreetMap (de subareas van de gemeente, omgezet naar vlakken in `grenzen.ts`). Test: `tests/kroegimport.test.mjs` |
| Google-kroegen | `migrations/20261106170000_google_kroegen.sql`, `migrations/20261106180000_google_koppeling.sql` | Place ID, categorieën en openingstijden uit Google op `kroegen`, en `importeer_google_kroegen`: koppelt Google-plaatsen aan OSM-kroegen (gelijkende naam, beste eerst) of voegt ze toe. Geen beoordelingen, telefoon of website. Aangeroepen door [`tools/google-kroegen`](../tools/google-kroegen/README.md). |
| Menukaartprijzen | `migrations/20261106200000_menukaartprijzen.sql` | Prijzen van menukaarten (met datum) als eerste stuk geschiedenis, zonder melder. Kolom `bron` op `gebeurtenissen`, import `importeer_menuprijzen` (alleen `service_role`) |
| Openingstijden en sluiten | `migrations/20261106190000_kroeg_meldingen.sql` | Spelers passen openingstijden aan of melden een kroeg als definitief gesloten; geen punten. Overzicht `kroeg_info` |
| Klopt deze kroeg niet? | `migrations/20261107120000_kroeg_klopt_niet.sql` | Ook verkeerde plek en dubbel melden, met een korte toelichting. Een bevestigde dubbele kroeg verdwijnt van de kaart; een verkeerde plek verplaatst een beheerder |
| Teksten | `migrations/20261107150000_app_teksten.sql` | Tabel `app_teksten` en functie `zet_tekst`: een beheerder herschrijft elke tekst in de app. Sleutel is de standaardtekst met getallen als `#` |
| Samenvoegen | `migrations/20261110130000_samenvoegen.sql`, `migrations/20261121220000_samenvoegen_fotos.sql`, `functions/samenvoegen/index.ts` | Een anonieme speler logt in met een bestaand account: meldingen, oordelen, punten, check-ins, foto's van de kaart, bugmeldingen, stadsaanvragen en ontdekte kroegen gaan over naar het account (`private.voeg_samen`, alleen service_role), daarna wordt de anonieme speler verwijderd. Geweigerd als het account een melding van de anonieme speler beoordeelde |
| Punten meteen | `migrations/20261113180000_punten_meteen.sql` | Punten bij melden en bij "klopt" meteen (triggers `punten_bij_melding` en `punten_bij_bevestiging`); `rond_af` trekt ze in als een melding wordt weerlegd. Wachtende meldingen kregen hun punten bij het uitvoeren |
| Berichten (eerst Bugs melden) | `migrations/20261113120000_bugmeldingen.sql`, `migrations/20261122120000_berichten.sql` | Tabel `bugmeldingen` en functie `meld_bug(tekst, scherm, apparaat)`: elke speler stuurt vanuit Ik een vraag, suggestie, probleem of opmerking, hoogstens 10 per dag. Alleen beheerders lezen ze (in de app onder Beheer, Berichten) |
| Inbox voor berichten | `migrations/20261122200000_inbox.sql` | Elk bericht is een gesprek. Tabel `bericht_antwoorden`; `bugmeldingen` krijgt `status` (open of afgehandeld), `laatste_op`, `laatste_van_beheer` en `beheer_gelezen_op` en `speler_gelezen_op` (wat nieuw is). `beantwoord_bericht(bericht, tekst)`: een beheerder antwoordt op elk bericht, een speler alleen op zijn eigen, hoogstens 20 per dag; een reactie van de speler zet het gesprek weer open. `lees_bericht(bericht)` zet het gesprek op gelezen, `zet_bericht_status(bericht, status)` handelt af (alleen beheerders). De speler leest zijn eigen berichten en de antwoorden erop (Ik, Jouw berichten), een beheerder alles (Ik, Beheer, Berichten). Beide tabellen staan in realtime |
| Nieuwe stad aanvragen | `migrations/20261120170000_stadsaanvragen.sql`, `migrations/20261124120000_gemeentelijst.sql` | Tabel `gemeenten` (342 Nederlandse en 565 Belgische gemeenten met provincie; code `GM` plus CBS-code of `BE` plus NIS-code; iedereen leest). Tabel `stadsaanvragen`, `vraag_stad_aan(code)` (elke speler kiest een gemeente uit de lijst, hoogstens 5 per dag, een gemeente een keer per speler) en `zet_stadsaanvraag(stad, status)` (alleen beheerders). Alleen beheerders lezen de aanvragen. Goedkeuren in de app (Ik, Beheer, Stadsaanvragen) roept `osm-import` aan met de gemeentecode |
| Kroeg ontbreekt | `migrations/20261125150000_kroeg_voorstellen.sql` | Tabel `kroeg_voorstellen`, `stel_kroeg_voor(naam, lat, lon, toelichting)` (elke speler, ook anoniem; hoogstens 5 open voorstellen per speler) en `zet_kroegvoorstel(id, status)` (alleen beheerders). De gemeente volgt uit de wijk van de plek, anders uit de dichtstbijzijnde kroeg binnen 3 km; daarbuiten geweigerd. Een open kroeg of open voorstel met een gelijkende naam binnen 75 m wordt geweigerd. Goedkeuren zet een kroeg zonder `osm_id` op de kaart, zonder prijs. `importeer_kroegen` koppelt zo'n kroeg later aan dezelfde kroeg in OSM (gelijkende naam, dezelfde grenzen als de Google-koppeling) in plaats van een tweede kroeg te maken. Geen punten voor het voorstel. Mail aan de beheerder met de soort `kroeg` |
| Stadskeuze | `migrations/20261120190000_tijdlijn_gemeente.sql` | Kolom `gemeente` achteraan op `kroeg_tijdlijn`, zodat de app de koers per gekozen stad laadt |
| Mail bij een melding | `migrations/20261121100000_meldingen_mailen.sql`, `functions/melding-mail/` | Na een nieuw bericht, een stadsaanvraag of een voorgestelde kroeg mailt de app de beheerder via de Infomaniak-mailbox. Heeft de speler een e-mailadres (uit de sessie), dan wordt dat het antwoordadres. Bij een antwoord in een gesprek (soort `antwoord`, `migrations/20261122200000_inbox.sql`) gaat een antwoord van de beheerder naar het e-mailadres van de speler (opgezocht met de service_role; zonder e-mailadres geen mail) en een reactie van de speler naar de beheerder. De Edge Function `melding-mail` controleert de sessie van de speler en roept `claim_melding_mail(soort, id, melder)` aan (alleen service_role): die zet `gemaild_op`, zodat elke melding hoogstens een keer wordt gemaild, alleen door de melder en binnen 10 minuten. Mislukt het versturen, dan geeft de functie de melding weer vrij. Instelling: secret `SMTP_WACHTWOORD` (apparaatwachtwoord van Infomaniak), optioneel `SMTP_GEBRUIKER`, `SMTP_HOST` en `MELDING_NAAR`. Poort 465 (Supabase laat 25 en 587 niet door) |
| Foto van de kaart | `migrations/20261121180000_kaartfotos.sql` | Een foto van de kaart bij een kroeg zetten, los van een prijsmelding: tabel `kroeg_fotos`, overzicht `kroeg_foto_overzicht` (met spelersnaam) en `meld_foto(kroeg, pad)`. De foto gaat eerst naar de bucket `prijslijsten` in de eigen map. Hoogstens 10 per speler per dag, ook voor anonieme spelers |
| Punten en verwijderen bij een kaartfoto | `migrations/20261121200000_kaartfotos_punten_verwijderen.sql` | +5 voor de eerste foto die je bij een kroeg zet (kolom `kroeg_fotos.punten`, `punten.kaartfoto_id`), `verwijder_foto(id)` voor je eigen foto: de punten gaan eraf en de foto verdwijnt voor iedereen (`verwijderd_op`). Een verwijderde foto telt mee voor de daglimiet en voor "eerste foto per kroeg" |
| Prijs vervangen | `migrations/20261121140000_prijs_vervangen.sql` | Een andere prijs vervangt een openstaande melding van een speler (status `vervangen`, kolom `vervangen_door`), zonder straf voor de melder. Zie Spelregels, Vervangen |
| Account verwijderen | `functions/account-verwijderen/index.ts` | Edge Function: de ingelogde speler verwijdert het eigen account. Meldingen en prijzen blijven staan zonder naam |
| Instellingen | `config.toml` | Instellingen voor de Supabase CLI |
| Inlogmail | `templates/inlogcode.html` | Tekst van de mail met de inlogcode (`{{ .Token }}`) |
| Tests | `tests/database.test.mjs` | Alle migraties en spelregels in een Postgres in het geheugen (PGlite met PostGIS). Draai `npm install` en daarna `npm run test:db`. |

## Datamodel

| Tabel | Inhoud |
|---|---|
| `profielen` | Spelers: naam, `naam_vast`, betrouwbaarheid (0 tot 100), beheerder ja/nee. Wordt automatisch aangemaakt bij registratie. |
| `wijken` | CBS-wijken met hun vorm (PostGIS). |
| `kroegen` | Kroegen uit OSM met locatie, ontdekker en de laatste bevestigde prijs. |
| `gebeurtenissen` | Audit-log: eerste prijs, wijziging of controle, met status `wacht`, `bevestigd` of `weerlegd`. |
| `bevestigingen` | Oordelen van andere spelers over een melding (`klopt` of `klopt_niet`). |
| `punten` | Audit-log van punten; de ranglijst is een query hierop. |
| `biersoorten` | Vaste lijst soorten voor extra bier (Guinness, witbier, IPA en meer). |
| `kroeg_aanbod` | Extra bier per kroeg: soort, merk, glas en prijs (beide optioneel), met status `actief`, `vervangen` of `weg`. Een nieuwe prijs vervangt de oude; niets wordt verwijderd. |
| `aanbod_oordelen` | "Klopt" of "klopt niet" bij extra bier, een per speler per bier. |
| `kroeg_meldingen` | Openingstijden of "definitief gesloten" gemeld door een speler, met status `wacht`, `bevestigd` of `weerlegd`. Per kroeg en soort hoogstens een open melding. |
| `kroegmelding_oordelen` | "Klopt" of "klopt niet" bij zo'n melding, een per speler per melding. |
| `incheckingen` | Check-ins per speler en kroeg, hoogstens een per dag. Privé: alleen de speler zelf kan ze lezen en wissen. |
| `kroeg_fotos` | Foto's van de kaart bij een kroeg, los van een prijsmelding. Openbaar leesbaar (zolang `verwijderd_op` leeg is); schrijven alleen via `meld_foto` en `verwijder_foto` (alleen je eigen foto). Een ongepaste foto van een ander verwijdert een beheerder in de SQL Editor, zie ACTIES.md. |
| `bugmeldingen` | Berichten van spelers (vragen, suggesties, problemen, opmerkingen): tekst, schermgrootte en browser, met de status van het gesprek. De speler leest zijn eigen berichten, een beheerder alles; schrijven alleen via `meld_bug`, `beantwoord_bericht`, `lees_bericht` en `zet_bericht_status`. |
| `bericht_antwoorden` | Antwoorden in een gesprek over een bericht, van een beheerder of van de speler die het bericht stuurde. Zelfde leesregels als `bugmeldingen`; schrijven alleen via `beantwoord_bericht`. |
| `stad_kaders` (view) | Rechthoek om de open kroegen per gemeente, zodat de app alleen de steden in beeld laadt. Iedereen leest. |
| `stad_grenzen` (view) | Vereenvoudigde grens per gemeente (de wijken samengevoegd), voor de stad die het meest van het scherm vult. Iedereen leest. |
| `gemeenten` | Gemeenten in Nederland en België die spelers kunnen aanvragen, met provincie en een andere naam om op te zoeken (Den Bosch, Luik). Iedereen leest; alleen migraties schrijven. |
| `stadsaanvragen` | Steden die spelers willen vrijspelen, met gemeentecode en status open, goedgekeurd of afgewezen. Alleen beheerders lezen ze; schrijven alleen via `vraag_stad_aan` en `zet_stadsaanvraag`. |
| `kroeg_voorstellen` | Kroegen die volgens spelers ontbreken: naam, toelichting, plek, gemeente en status open, goedgekeurd of afgewezen, met de kroeg die eruit voortkwam. Alleen beheerders lezen ze; schrijven alleen via `stel_kroeg_voor` en `zet_kroegvoorstel`. |
| `kaartscans` | Een rij per bezoek via een gedrukte QR-code, zoals `bierkoers.nl/k` op het terraskaartje: alleen `bron` en tijdstip `op`, geen persoonsgegevens. Zie Kaartscans hieronder. |

Overzichten voor de app (alle met `security_invoker`): `kroeg_kaart`, `kroeg_tijdlijn`, `ranglijst`, `stad_voortgang`, `wijk_voortgang`, `aanbod_overzicht`, `kroeg_info`, `kroeg_bijdragers`, `kroeg_stamgast` en `mijn_kroegen` (alleen de eigen check-ins). Plus de functie `kroegen_in_de_buurt(lat, lon, straal_m)`.

## Spelregels in de database

De prijs voor het spel is de goedkoopste pils van de tap in een vaasje (25 cl). Schenkt een kroeg geen vaasje, dan meld je het kleinste glas en rekent de app om naar 25 cl (`per25_cent`). Iedereen mag alles lezen. Schrijven gaat alleen via deze functies, zodat niemand zichzelf punten kan geven:

- `meld_prijs(kroeg, merk, volume_cl, prijs_cent, lat, lon, foto_pad)`: eerste prijs (speelt de kroeg vrij) of prijswijziging. Ter plaatse = binnen 75 m. Staat er een menukaartprijs, dan kan dezelfde prijs alleen ter plaatse.
- `beoordeel(gebeurtenis, 'klopt' | 'klopt_niet')`: een melding van een ander bevestigen of weerleggen.
- `klopt_nog(kroeg, lat, lon)`: de huidige prijs controleren, hoogstens een keer per kroeg per 7 dagen.
- `meld_aanbod(kroeg, soort, merk, volume_cl, prijs_cent)`: extra bier toevoegen of een nieuwe prijs ervan melden. Merk, glas en prijs zijn optioneel; bij een prijs hoort een glas. Geen punten.
- `beoordeel_aanbod(aanbod, 'klopt' | 'klopt_niet')`: extra bier van een ander bevestigen (zet de datum van controle) of afkeuren; twee keer "klopt niet" en het verdwijnt. Je eigen extra trek je in met "klopt niet". Alleen met e-mailadres, behalve intrekken.
- `meld_kroeg(kroeg, 'openingstijden' | 'gesloten' | 'verkeerde_plek' | 'dubbel', openingstijden, toelichting)`: andere openingstijden, een definitieve sluiting, een verkeerde plek op de kaart of een dubbele kroeg melden. Openingstijden zijn per dag een lijst als `["16:00-02:00"]`; een lege lijst is gesloten. De toelichting (hoogstens 280 tekens) hoort niet bij openingstijden. Ook zonder e-mailadres. Geen punten. Een gesloten of dubbele kroeg verdwijnt na "klopt" van een andere speler met e-mailadres van de kaart.
- `beoordeel_kroegmelding(melding, 'klopt' | 'klopt_niet')`: zo'n melding van een ander bevestigen of afkeuren. Alleen met e-mailadres; je eigen melding trek je in met "klopt niet".
- `stel_kroeg_voor(naam, lat, lon, toelichting)`: een kroeg voorstellen die op de kaart ontbreekt. Ook zonder e-mailadres. Geen punten; de kroeg komt pas na goedkeuring door een beheerder op de kaart (`zet_kroegvoorstel`).
- `inchecken(kroeg, lat, lon)`: inchecken in een kroeg, alleen binnen 75 m en hoogstens een keer per kroeg per dag. Een melding of "klopt nog" ter plaatse is automatisch ook een check-in (trigger op `gebeurtenissen`).

| Regel | Uitwerking |
|---|---|
| Bevestigd | Een melder met betrouwbaarheid boven 90% heeft een andere speler nodig; alle andere melders hebben twee andere spelers nodig. Een oordeel van een speler boven 90% telt dubbel, dus een betrouwbare controleur is genoeg voor een gewone melder. Niemand wordt bevestigd zonder dat een andere speler ernaar gekeken heeft. |
| Wachtende prijs | Een melding die nog op bevestiging wacht, wordt in de app als meest recente prijs getoond (met een ? erachter) naast de laatst bevestigde prijs. `kroeg_kaart` heeft daarvoor de kolommen `open_merk`, `open_volume_cl`, `open_prijs_cent`, `open_per25_cent` en `open_op`. Versheid, de mediaan en de prijs op de kroeg tellen alleen de bevestigde prijs. Punten komen er meteen bij melden (zie Punten). |
| Uitschieter | Meer dan 40% van de mediaan van de stad per 25 cl, of meer dan 25% duurder of 10% goedkoper dan de vorige prijs van de kroeg (`private.is_uitschieter`). De mediaan telt per open kroeg de bevestigde prijs, anders een openstaande menukaartprijs, vanaf 3 prijzen (`private.mediaan_per25`); de vorige prijs is de bevestigde, anders de menukaartprijs. Een uitschieter heeft altijd twee bevestigingen van anderen nodig, de melder krijgt zijn punten pas na bevestiging, en de app zet hem tot die tijd niet op de kaart (`kroeg_kaart.open_uitschieter`). Migratie `20261122150000_uitschieters`. |
| Weerlegd | Twee keer "klopt niet" (of een keer van een speler boven 90%). Een weerlegde eerste prijs zet de kroeg terug onder de mist. |
| Vervangen | Een andere prijs bij een melding die nog op bevestiging wacht vervangt die melding (`private.meld_prijs`): de oude krijgt de status `vervangen`, de melder houdt zijn punten en zijn betrouwbaarheid, en wie "klopt" zei ook. De nieuwe melding wacht zoals altijd op bevestiging. Alleen met een gekoppeld e-mailadres, nooit op je eigen melding, nooit met dezelfde prijs (daar is "klopt" voor) en hoogstens 5 keer per speler per dag. "Klopt niet" blijft voor een prijs die overduidelijk fout is. |
| Punten | Vrijspelen +50, wijziging +30, bevestigen +5, klopt nog +5 (hoogstens een keer per week per kroeg, en niet binnen 7 dagen na een eigen melding of "klopt" bij die kroeg, migratie `20261126110000_klopt_nog_na_bevestigen`), oude prijs (90+ dagen) controleren +15, foto bij een prijs +5, foto van de kaart +5 (alleen de eerste per kroeg per speler; verwijder je hem, dan gaan de punten eraf en levert opnieuw uploaden niets op), ter plaatse x1,5, weerlegd -20. Punten meteen bij melden en bij "klopt" (migratie `20261113180000_punten_meteen`), behalve bij een uitschieter: die punten komen bij bevestiging; wordt een melding weerlegd, dan gaan de punten van de melder en van wie "klopt" zei er weer af. |
| Betrouwbaarheid | Voorlopig, nog niet definitief. Start op 50. Bevestigde melding +10% van wat je mist tot 100, weerlegde melding -20% van je score, juist oordeel +3% van wat je mist, onjuist oordeel -6% van je score (`private.betrouwbaarheid_na`). Boven 90% pas met minstens 20 bevestigde eigen meldingen, bevestigd door minstens 5 verschillende anderen (`private.ervaren_melder`); tot die tijd hoogstens 90. |
| Anonieme spelers | Beginnen zonder e-mailadres en mogen prijzen melden. Bevestigen, weerleggen en "klopt nog" kan pas met een gekoppeld e-mailadres, en een anonieme melder wordt nooit zonder een andere speler bevestigd. Zo kan niemand met wegwerpaccounts zijn eigen meldingen bevestigen. Na het koppelen blijft het account met alle punten en check-ins hetzelfde. Een anonieme speler krijgt een willekeurige naam (bijvoeglijk naamwoord en iets met bier of een dier, zoals `schuimende-gerst`) en kiest pas na het koppelen een eigen naam (trigger `private.naam_niet_anoniem()`), zodat wegwerpaccounts geen eigen naam op de ranglijst zetten. |
| Samenvoegen | Logt een anonieme speler in met een account dat hij al had, dan gaan zijn bijdragen mee naar dat account. Dubbele check-ins (zelfde kroeg, zelfde dag), dubbele oordelen en dubbele stadsaanvragen van de anonieme speler vervallen. Had het account al een foto van de kaart bij dezelfde kroeg, dan levert de foto van de anonieme speler daar geen punten meer op (hoogstens 5 per kroeg per speler); de betrouwbaarheid van het account blijft. Heeft het account een melding van de anonieme speler beoordeeld, dan weigeren we het samenvoegen: anders bevestig je je eigen melding. |
| Menukaartprijs | Een prijs van een menukaart staat in de geschiedenis en op de kaart (met ?), met de datum van de kaart en zonder melder. De kroeg blijft onder de mist en niemand krijgt er punten voor. Dezelfde prijs melden ("Klopt, ik ben er") kan alleen ter plaatse (binnen 75 m): de speler wordt indiener en ontdekker, daarna gelden de gewone regels (bevestiging door anderen, dan de vrijspeelpunten). Een andere prijs melden kan overal; de menukaartprijs is dan achterhaald. Over een menukaartprijs zelf kun je niet oordelen. Alleen kroegen zonder bevestigde prijs krijgen een menukaartprijs. |
| Openingstijden | Komen uit Google. Tijden van een speler gelden meteen en Google overschrijft ze daarna niet meer. Een andere speler kan "klopt" zeggen; twee keer "klopt niet" (of intrekken) en de vorige tijden komen terug. |
| Definitief gesloten | Pas na "klopt" van een andere speler met e-mailadres verdwijnt de kroeg van de kaart. Twee keer "klopt niet" en de melding is weerlegd. De OSM- en Google-import openen zo'n kroeg niet opnieuw (`gesloten_door_spelers`). |
| Verkeerde plek en dubbel | Ook zonder e-mailadres te melden, met een korte toelichting. Een verkeerde plek blijft staan tot een beheerder hem verplaatst. Een dubbele kroeg verdwijnt na "klopt" van een andere speler met e-mailadres van de kaart; de imports zetten hem niet terug. |
| Stamgast | Per kroeg de speler met de meeste dagen met een bevestigde bijdrage (eigen meldingen plus "klopt" op meldingen die bevestigd zijn), vanaf 2 dagen; meerdere bijdragen op een dag tellen als een. Bij gelijkspel wie de stand het eerst bereikte. Geen punten, alleen de naam bovenaan de geschiedenis. |
| Inchecken | Binnen 75 m, een keer per kroeg per dag. Geen punten (we belonen nooit kroegbezoek). Alleen zichtbaar voor de speler zelf; wissen kan altijd. |

## Installeren op het Supabase-project

Stap 1 en 2 zijn al gedaan op project `yzaootlrhxzyxtvacrot`: het schema staat erin (migratie `20261105180124`, 5 november 2026; `20261105220601`, 5 november 2026; `20261106090000` tot en met `20261106190000`, 6 november 2026; de Google-kroegen van Nijmegen zijn geïmporteerd), de Edge Function `osm-import` draait en de Security Advisor is schoon op een waarschuwing over gelekte wachtwoorden na (BPDB gebruikt geen wachtwoorden). De migraties `20261106210000_inchecken` en `20261106220000_betrouwbaarheid_verwachting` staan er ook in (6 november 2026). Op 7 november 2026 kwamen `20261107120000_kroeg_klopt_niet` en de Edge Function `account-verwijderen` erbij. Voor een nieuw project:

**1. Schema toepassen.** Vanuit de hoofdmap van de repo:

```bash
supabase link --project-ref <project-ref>
```

```bash
supabase db push
```

Of plak de migratie in de SQL Editor van het dashboard.

**2. Edge Function uitrollen:**

```bash
supabase functions deploy osm-import
supabase functions deploy account-verwijderen
supabase functions deploy samenvoegen
supabase functions deploy melding-mail
```

**3. Inloggen instellen.** Nieuwe spelers beginnen anoniem, zonder e-mailadres. Wie zijn punten wil bewaren of prijzen van anderen wil bevestigen, koppelt later een e-mailadres. Bestaande spelers loggen in met een code van 6 cijfers die ze per mail krijgen en in de app typen. Een link gebruiken we niet meer: die werkt maar een keer, gaat stuk als een virusscanner van het mailprogramma hem eerst opent, en opent op een iPhone in Safari in plaats van in de app op het beginscherm. In het dashboard, onder Authentication:

- **Sign In / Providers:** zet **Allow anonymous sign-ins** en **Allow manual linking** aan. Zonder het eerste kan niemand nieuw meedoen.
- **Attack Protection:** zet bij voorkeur een captcha aan (Cloudflare Turnstile), anders kan iemand massaal anonieme accounts aanmaken. Let op: de app stuurt nog geen captcha mee; dat moet eerst in de app worden ingebouwd. Tot die tijd geldt de limiet van 30 nieuwe anonieme accounts per uur per IP-adres (Rate Limits).
- **Emails, Templates:** zet bij **Magic Link** (inloggen), **Change Email Address** (een anonieme speler koppelt zijn e-mailadres) en **Confirm signup** dezelfde tekst, met `{{ .Token }}` erin. Onderwerp: `Je code voor Bierkoers`. Tekst: kopieer `supabase/templates/inlogcode.html`. Staat er geen `{{ .Token }}` in de mail, dan krijgt de speler geen code en kan hij niet inloggen.
- **Emails, SMTP Settings:** koppel een eigen mailprovider (bijvoorbeeld Resend of Postmark) met een eigen afzender. De standaardmailer van Supabase stuurt maar een paar mails per uur en alleen naar leden van je Supabase-team. Zonder eigen SMTP kunnen andere spelers dus geen code krijgen.
- **Rate Limits:** zet na het koppelen van SMTP het aantal mails per uur hoger (bijvoorbeeld 100).
- **URL Configuration:** Site URL `https://bpdb-nl.pages.dev`. Redirect URLs: `https://bpdb-nl.pages.dev/**` en voor lokaal testen `http://localhost:8765/**`. Dit is alleen nog nodig voor oude inloglinks.

**4. Jezelf beheerder maken.** Log eerst in via de app (tabblad Ik). Voer daarna in de SQL Editor uit:

```sql
update public.profielen set is_beheerder = true where naam = 'JOUW_SPELERSNAAM';
```

**5. Kroegen importeren.** Ga in de app naar Ik → Beheer → "Kroegen en wijken importeren". Dit haalt de kroegen (`amenity=pub|bar|biergarten`) van Nijmegen uit OpenStreetMap en de 9 CBS-wijken. Je kunt dit later opnieuw doen; bestaande kroegen en hun geschiedenis blijven behouden.

**5b. Kroegen uit Google Maps aanvullen (optioneel).** Pas eerst de migraties `20261106170000` tot en met `20261106190000` toe. Draai daarna lokaal `tools/google-kroegen` met `--naar-supabase` (zie de README daar). Openingstijden komen bij de bestaande OSM-kroegen; kroegen die in OSM ontbreken worden toegevoegd. Een kroeg die alleen uit Google komt gaat dicht na 2 volledige runs waarin hij niet meer voorkomt.

**6. Controleren.** Dashboard → Advisors → Security Advisor moet schoon zijn. Waarschuwingen over de PostGIS-tabel `spatial_ref_sys` kun je negeren.

## Migratie uitvoeren vanuit een sessie

Lezen en gewone `insert`, `update` en `delete` gaan via de Supabase-connector. Voor DDL (`apply_migration`, `create function` in `execute_sql`) vraagt de connector om een bevestiging in de Claude-app; zonder antwoord loopt de aanroep na 60 seconden vast. Werkt er niemand mee, dan zo:

1. Rol met `deploy_edge_function` een functie `eenmalig-migratie` uit met `verify_jwt: false`. De code importeert `npm:postgres@3.4.4`, verbindt met `Deno.env.get("SUPABASE_DB_URL")` en voert met `sql.unsafe()` alleen de vaste tekst van de migratie uit, plus de regel die de versie in `supabase_migrations.schema_migrations` zet en een controlequery. Hij draait alleen met een header `x-eenmalig` met een willekeurige sleutel (`openssl rand -hex 24`), anders 403.
2. Roep hem aan met `curl -X POST -H "x-eenmalig: <sleutel>" https://<project-ref>.supabase.co/functions/v1/eenmalig-migratie` en lees de controle.
3. Rol direct een lege versie uit (`verify_jwt: true`, altijd 410), gooi de sleutel weg en draai de beveiligingsadviezen. Een Edge Function verwijderen kan niet via de connector, alleen in het dashboard.

## Kroegen importeren vanuit een sessie

Overpass is vanuit een cloudsessie wisselend bereikbaar en `osm-import` vraagt een ingelogde beheerder. Zo gaat het toch:

1. `openssl rand -hex 24` geeft een sleutel; `printf %s <sleutel> | sha256sum` de hash.
2. Rol met `deploy_edge_function` de functie `eenmalig-import` uit met `verify_jwt: false` en alleen dit `index.ts`: `import { start } from "https://raw.githubusercontent.com/Hoogveldt-dev/BPDB-NL/<commit>/supabase/functions/eenmalig-import/index.ts"; start("<hash>");` (geef ook een `deno.json` met `{"imports":{}}` en `import_map_path: "deno.json"` mee). De code wordt bij het uitrollen gebundeld.
3. `EENMALIG=<sleutel> tools/google-kroegen/importeer-stad.sh <gemeentecode>`: haalt Overpass op met nieuwe pogingen, accepteert alleen een volledig antwoord en stuurt het door naar `osm-import`.
4. Rol direct een lege versie uit (`verify_jwt: true`, altijd 410) en gooi de sleutel weg.

## Kaartscans

Het terraskaartje heeft een QR-code naar `https://bierkoers.nl/k`. `app/kaartscan.js` draait voor `app.js`: het zet het adres terug naar `/` en voegt een rij toe aan `kaartscans` met de bron (`kaartje`). Verversen telt dus niet opnieuw. Een nieuwe drukwerkversie krijgt een eigen pad in `BRONNEN` in `app/kaartscan.js`.

Iedereen mag een rij toevoegen (alleen de kolom `bron`), niemand mag via de API lezen, wijzigen of wissen. Uitlezen in de SQL Editor:

```sql
select date_trunc('day', op at time zone 'Europe/Amsterdam')::date as dag, count(*)
from public.kaartscans
where bron = 'kaartje'
group by 1
order by 1 desc;
```

## Beveiliging

- Zet nooit de service_role-key, secret key of het databasewachtwoord in de app of in git. De publishable key in `app/config.js` is bedoeld voor de browser.
- Alle tabellen hebben RLS. Spelers kunnen alleen hun eigen naam kiezen, en maar een keer: wie bij het aanmelden een naam kiest, houdt die (`naam_vast`). Wie een automatische naam kreeg (een willekeurige naam als `dorstige-zebra`, of bij oudere accounts `speler`, `speler2`, bijvoorbeeld via Apple of Google), kiest een keer zelf; een anonieme speler pas na het koppelen van een e-mailadres. Daarna weigert de trigger `private.naam_eenmalig()` een nieuwe naam. Een beheerder kan in de SQL Editor altijd een naam wijzigen (`update public.profielen set naam = '...' where id = '...'`).
- Check-ins zijn locatiegeschiedenis en dus persoonsgegevens: `incheckingen` is als enige tabel niet openbaar leesbaar, ook niet voor andere ingelogde spelers.
- Spelers kunnen hun eigen check-ins wissen.
- De spellogica draait als `security definer` in het schema `private`, dat niet via de API bereikbaar is. Elke functie controleert zelf `auth.uid()`.
- Foto's mogen alleen in de eigen map (`<gebruikers-id>/...`) van de bucket `prijslijsten` worden geüpload, maximaal 5 MB.
