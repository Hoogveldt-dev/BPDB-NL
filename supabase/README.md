# Supabase-backend van BPDB

Alles wat in de database en bij Supabase draait, staat in deze map.

| Onderdeel | Bestand | Wat het doet |
|---|---|---|
| Schema en spelregels | `migrations/20261105180124_kroegkaart_schema.sql` | Tabellen, toegangsregels (RLS), punten, peer-bevestiging, overzichten, realtime, opslag voor foto's |
| Kroegimport | `functions/osm-import/index.ts` | Edge Function: kroegen uit OpenStreetMap, wijken van het CBS (PDOK) |
| Instellingen | `config.toml` | Instellingen voor de Supabase CLI |

## Datamodel

| Tabel | Inhoud |
|---|---|
| `profielen` | Spelers: naam, betrouwbaarheid (0 tot 100), beheerder ja/nee. Wordt automatisch aangemaakt bij registratie. |
| `wijken` | CBS-wijken met hun vorm (PostGIS). |
| `kroegen` | Kroegen uit OSM met locatie, ontdekker en de laatste bevestigde prijs. |
| `gebeurtenissen` | Audit-log: eerste prijs, wijziging of controle, met status `wacht`, `bevestigd` of `weerlegd`. |
| `bevestigingen` | Oordelen van andere spelers over een melding (`klopt` of `klopt_niet`). |
| `punten` | Audit-log van punten; de ranglijst is een query hierop. |

Overzichten voor de app (alle met `security_invoker`): `kroeg_kaart`, `kroeg_tijdlijn`, `ranglijst`, `stad_voortgang`, `wijk_voortgang`. Plus de functie `kroegen_in_de_buurt(lat, lon, straal_m)`.

## Spelregels in de database

Iedereen mag alles lezen. Schrijven gaat alleen via drie functies, zodat niemand zichzelf punten kan geven:

- `meld_prijs(kroeg, merk, volume_cl, prijs_cent, lat, lon, foto_pad)`: eerste prijs (speelt de kroeg vrij) of prijswijziging. Ter plaatse = binnen 75 m.
- `beoordeel(gebeurtenis, 'klopt' | 'klopt_niet')`: een melding van een ander bevestigen of weerleggen.
- `klopt_nog(kroeg, lat, lon)`: de huidige prijs controleren, hoogstens een keer per kroeg per 7 dagen.

| Regel | Uitwerking |
|---|---|
| Bevestigd | Melder plus een andere speler. Een melder met betrouwbaarheid boven 90% is direct bevestigd. |
| Uitschieter | Meer dan 40% van de mediaan per 25 cl (vanaf 5 prijzen in de stad): altijd twee bevestigingen van anderen. |
| Weerlegd | Twee keer "klopt niet" (of een keer van een speler boven 90%). Een weerlegde eerste prijs zet de kroeg terug onder de mist. |
| Punten | Vrijspelen +50, wijziging +30, bevestigen +5, klopt nog +5, oude prijs (90+ dagen) controleren +15, foto +5, ter plaatse x1,5, weerlegd -20. Punten pas na bevestiging. |
| Betrouwbaarheid | Start op 50. Bevestigde melding +2, weerlegde melding -10, juist oordeel +1, onjuist oordeel -3. |

## Installeren op het Supabase-project

Stap 1 en 2 zijn al gedaan op project `yzaootlrhxzyxtvacrot` (5 november 2026): het schema staat erin (migratie `20261105180124`), de Edge Function `osm-import` draait en de Security Advisor is schoon. Voor een nieuw project:

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
```

**3. Inloggen instellen.** Dashboard → Authentication → URL Configuration: zet de Site URL op het adres waar de app draait (bijvoorbeeld je GitHub Pages-adres) en voeg dat adres toe aan de Redirect URLs. Voor lokaal testen: `http://localhost:8765`.

**4. Jezelf beheerder maken.** Log eerst in via de app (tabblad Ik). Voer daarna in de SQL Editor uit:

```sql
update public.profielen set is_beheerder = true where naam = 'JOUW_SPELERSNAAM';
```

**5. Kroegen importeren.** Ga in de app naar Ik → Beheer → "Kroegen en wijken importeren". Dit haalt de kroegen (`amenity=pub|bar|biergarten`) van Nijmegen uit OpenStreetMap en de 9 CBS-wijken. Je kunt dit later opnieuw doen; bestaande kroegen en hun geschiedenis blijven behouden.

**6. Controleren.** Dashboard → Advisors → Security Advisor moet schoon zijn. Waarschuwingen over de PostGIS-tabel `spatial_ref_sys` kun je negeren.

## Beveiliging

- Zet nooit de service_role-key, secret key of het databasewachtwoord in de app of in git. De publishable key in `app/config.js` is bedoeld voor de browser.
- Alle tabellen hebben RLS. Spelers kunnen alleen hun eigen naam wijzigen.
- De spellogica draait als `security definer` in het schema `private`, dat niet via de API bereikbaar is. Elke functie controleert zelf `auth.uid()`.
- Foto's mogen alleen in de eigen map (`<gebruikers-id>/...`) van de bucket `prijslijsten` worden geüpload, maximaal 5 MB.
