# Supabase-backend van BPDB

Alles wat in de database en bij Supabase draait, staat in deze map.

| Onderdeel | Bestand | Wat het doet |
|---|---|---|
| Schema en spelregels | `migrations/20261105180124_kroegkaart_schema.sql` | Tabellen, toegangsregels (RLS), punten, peer-bevestiging, overzichten, realtime, opslag voor foto's |
| Anonieme spelers | `migrations/20261106090000_anonieme_spelers.sql` | Meteen meespelen zonder e-mailadres; bevestigen alleen met e-mailadres |
| Willekeurige spelersnaam | `migrations/20261110120000_willekeurige_spelersnaam.sql` | Anonieme spelers en spelers zonder naam krijgen een naam als `dorstige-zebra` (`private.willekeurige_naam()`); een eigen naam pas na het koppelen van een e-mailadres |
| Betrouwbaarheid naar verwachting | `migrations/20261106220000_betrouwbaarheid_verwachting.sql` | Voorlopig (Kjell is er nog niet tevreden over). Hoe verrassender de uitkomst, hoe groter de sprong; boven 90% pas met ervaring |
| Bevestigen naar betrouwbaarheid | `migrations/20261106150000_bevestigen_naar_betrouwbaarheid.sql` | Melder boven 90%: een andere speler; anderen: twee. Geen automatische bevestiging meer. `kroeg_kaart` toont de wachtende prijs |
| Extra bier | `migrations/20261106120000_extra_bier.sql` | Wat een kroeg naast de pils tapt (Guinness, witbier, ander merk), met of zonder prijs; geen punten |
| Stamkroeg | `migrations/20261105220601_stamkroeg.sql` | Overzichten `kroeg_bijdragers` en `kroeg_stamgast`: wie per kroeg het vaakst bijwerkt of bevestigt |
| Inchecken | `migrations/20261106210000_inchecken.sql` | Tabel `incheckingen`, functie `inchecken`, overzicht `mijn_kroegen`: de eigen kaart van elke speler |
| Kroegimport | `functions/osm-import/index.ts` | Edge Function: kroegen uit OpenStreetMap, wijken van het CBS (PDOK) |
| Google-kroegen | `migrations/20261106170000_google_kroegen.sql`, `migrations/20261106180000_google_koppeling.sql` | Place ID, categorieën en openingstijden uit Google op `kroegen`, en `importeer_google_kroegen`: koppelt Google-plaatsen aan OSM-kroegen (gelijkende naam, beste eerst) of voegt ze toe. Geen beoordelingen, telefoon of website. Aangeroepen door [`tools/google-kroegen`](../tools/google-kroegen/README.md). |
| Menukaartprijzen | `migrations/20261106200000_menukaartprijzen.sql` | Prijzen van menukaarten (met datum) als eerste stuk geschiedenis, zonder melder. Kolom `bron` op `gebeurtenissen`, import `importeer_menuprijzen` (alleen `service_role`) |
| Openingstijden en sluiten | `migrations/20261106190000_kroeg_meldingen.sql` | Spelers passen openingstijden aan of melden een kroeg als definitief gesloten; geen punten. Overzicht `kroeg_info` |
| Klopt deze kroeg niet? | `migrations/20261107120000_kroeg_klopt_niet.sql` | Ook verkeerde plek en dubbel melden, met een korte toelichting. Een bevestigde dubbele kroeg verdwijnt van de kaart; een verkeerde plek verplaatst een beheerder |
| Teksten | `migrations/20261107150000_app_teksten.sql` | Tabel `app_teksten` en functie `zet_tekst`: een beheerder herschrijft elke tekst in de app. Sleutel is de standaardtekst met getallen als `#` |
| Samenvoegen | `migrations/20261110130000_samenvoegen.sql`, `functions/samenvoegen/index.ts` | Een anonieme speler logt in met een bestaand account: meldingen, oordelen, punten, check-ins en ontdekte kroegen gaan over naar het account (`private.voeg_samen`, alleen service_role), daarna wordt de anonieme speler verwijderd. Geweigerd als het account een melding van de anonieme speler beoordeelde |
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
- `inchecken(kroeg, lat, lon)`: inchecken in een kroeg, alleen binnen 75 m en hoogstens een keer per kroeg per dag. Een melding of "klopt nog" ter plaatse is automatisch ook een check-in (trigger op `gebeurtenissen`).

| Regel | Uitwerking |
|---|---|
| Bevestigd | Een melder met betrouwbaarheid boven 90% heeft een andere speler nodig; alle andere melders hebben twee andere spelers nodig. Een oordeel van een speler boven 90% telt dubbel, dus een betrouwbare controleur is genoeg voor een gewone melder. Niemand wordt bevestigd zonder dat een andere speler ernaar gekeken heeft. |
| Wachtende prijs | Een melding die nog op bevestiging wacht, wordt in de app als meest recente prijs getoond (met een ? erachter) naast de laatst bevestigde prijs. `kroeg_kaart` heeft daarvoor de kolommen `open_merk`, `open_volume_cl`, `open_prijs_cent`, `open_per25_cent` en `open_op`. Het spel (vrijspelen, punten, ranglijst, versheid, goedkoopste) telt alleen de bevestigde prijs. |
| Uitschieter | Meer dan 40% van de mediaan per 25 cl (vanaf 5 prijzen in de stad): altijd twee bevestigingen van anderen. |
| Weerlegd | Twee keer "klopt niet" (of een keer van een speler boven 90%). Een weerlegde eerste prijs zet de kroeg terug onder de mist. |
| Punten | Vrijspelen +50, wijziging +30, bevestigen +5, klopt nog +5, oude prijs (90+ dagen) controleren +15, foto +5, ter plaatse x1,5, weerlegd -20. Punten pas na bevestiging. |
| Betrouwbaarheid | Voorlopig; Kjell is er nog niet tevreden over. Start op 50. Bevestigde melding +10% van wat je mist tot 100, weerlegde melding -20% van je score, juist oordeel +3% van wat je mist, onjuist oordeel -6% van je score (`private.betrouwbaarheid_na`). Boven 90% pas met minstens 20 bevestigde eigen meldingen, bevestigd door minstens 5 verschillende anderen (`private.ervaren_melder`); tot die tijd hoogstens 90. |
| Anonieme spelers | Beginnen zonder e-mailadres en mogen prijzen melden. Bevestigen, weerleggen en "klopt nog" kan pas met een gekoppeld e-mailadres, en een anonieme melder wordt nooit zonder een andere speler bevestigd. Zo kan niemand met wegwerpaccounts zijn eigen meldingen bevestigen. Na het koppelen blijft het account met alle punten en check-ins hetzelfde. Een anonieme speler krijgt een willekeurige naam (bijvoeglijk naamwoord en iets met bier of een dier, zoals `schuimende-gerst`) en kiest pas na het koppelen een eigen naam (trigger `private.naam_niet_anoniem()`), zodat wegwerpaccounts geen eigen naam op de ranglijst zetten. |
| Samenvoegen | Logt een anonieme speler in met een account dat hij al had, dan gaan zijn bijdragen mee naar dat account. Dubbele check-ins (zelfde kroeg, zelfde dag) en dubbele oordelen van de anonieme speler vervallen; de betrouwbaarheid van het account blijft. Heeft het account een melding van de anonieme speler beoordeeld, dan weigeren we het samenvoegen: anders bevestig je je eigen melding. |
| Menukaartprijs | Een prijs van een menukaart staat in de geschiedenis en op de kaart (met ?), met de datum van de kaart en zonder melder. De kroeg blijft onder de mist en niemand krijgt er punten voor. Dezelfde prijs melden ("Klopt, ik ben er") kan alleen ter plaatse (binnen 75 m): de speler wordt indiener en ontdekker, daarna gelden de gewone regels (bevestiging door anderen, dan de vrijspeelpunten). Een andere prijs melden kan overal; de menukaartprijs is dan achterhaald. Over een menukaartprijs zelf kun je niet oordelen. Alleen kroegen zonder bevestigde prijs krijgen een menukaartprijs. |
| Openingstijden | Komen uit Google. Tijden van een speler gelden meteen en Google overschrijft ze daarna niet meer. Een andere speler kan "klopt" zeggen; twee keer "klopt niet" (of intrekken) en de vorige tijden komen terug. |
| Definitief gesloten | Pas na "klopt" van een andere speler met e-mailadres verdwijnt de kroeg van de kaart. Twee keer "klopt niet" en de melding is weerlegd. De OSM- en Google-import openen zo'n kroeg niet opnieuw (`gesloten_door_spelers`). |
| Verkeerde plek en dubbel | Ook zonder e-mailadres te melden, met een korte toelichting. Een verkeerde plek blijft staan tot een beheerder hem verplaatst. Een dubbele kroeg verdwijnt na "klopt" van een andere speler met e-mailadres van de kaart; de imports zetten hem niet terug. |
| Stamgast | Per kroeg de speler met de meeste bevestigde bijdragen (eigen meldingen plus "klopt" op meldingen die bevestigd zijn), vanaf 2. Bij gelijkspel wie de stand het eerst bereikte. Geen punten, alleen de naam bovenaan de geschiedenis. |
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

## Beveiliging

- Zet nooit de service_role-key, secret key of het databasewachtwoord in de app of in git. De publishable key in `app/config.js` is bedoeld voor de browser.
- Alle tabellen hebben RLS. Spelers kunnen alleen hun eigen naam kiezen, en maar een keer: wie bij het aanmelden een naam kiest, houdt die (`naam_vast`). Wie een automatische naam kreeg (een willekeurige naam als `dorstige-zebra`, of bij oudere accounts `speler`, `speler2`, bijvoorbeeld via Apple of Google), kiest een keer zelf; een anonieme speler pas na het koppelen van een e-mailadres. Daarna weigert de trigger `private.naam_eenmalig()` een nieuwe naam. Een beheerder kan in de SQL Editor altijd een naam wijzigen (`update public.profielen set naam = '...' where id = '...'`).
- Check-ins zijn locatiegeschiedenis en dus persoonsgegevens: `incheckingen` is als enige tabel niet openbaar leesbaar, ook niet voor andere ingelogde spelers.
- Spelers kunnen hun eigen check-ins wissen.
- De spellogica draait als `security definer` in het schema `private`, dat niet via de API bereikbaar is. Elke functie controleert zelf `auth.uid()`.
- Foto's mogen alleen in de eigen map (`<gebruikers-id>/...`) van de bucket `prijslijsten` worden geüpload, maximaal 5 MB.
