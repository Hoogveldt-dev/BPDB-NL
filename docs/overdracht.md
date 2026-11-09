# Overdracht voor de volgende sessie

Stand op 9 november 2026. Lees eerst `CLAUDE.md` (werkwijze en afspraken) en `ACTIES.md` (wat Kjell zelf moet doen).

## Stand van zaken

- `main` is de basis en staat live. Cloudflare Pages (project `bpdb-nl`) bouwt elke push naar `main`.
- `https://bierkoers.nl` toont de app (via Cloudflare, gecontroleerd op 9 november). `https://bpdb-nl.pages.dev` werkt ook.
- Supabase-project `yzaootlrhxzyxtvacrot`: alle migraties tot en met `20261107150000_app_teksten` staan live, met de versies gelijk aan de bestandsnamen. De Security Advisor meldt alleen gelekte wachtwoorden; dat doet er niet toe, want de app gebruikt geen wachtwoorden.
- Edge Functions live: `osm-import` en `account-verwijderen`.
- Tests: `npm run check` en `npm run test:db` (225 geslaagd), de tools in `tools/google-kroegen` (37 geslaagd).
- Geen open pull requests. PR #13 (`ux/gebruik-en-kaart`) is gesloten zonder merge: de goedgekeurde delen stonden al op `main` via PR #11, en de branch had een kapotte `esc()`.

## Wat we in deze sessie hebben gedaan

| PR | Inhoud |
|---|---|
| #10 | Beursthema: lichtkrant, tickercodes, Pilsindex, koerskaart, tab Beurs. Daarna aangepast aan trage bierprijzen: vergelijken met twaalf maanden terug, "vast sinds", "langst prijsvast", prijstrapje per rij. |
| #11 | Delen uit `ux/gebruik-en-kaart` met de hand overgezet en verbeterd: mist over de kaart, uitdijende kring bij vrijspelen, betere klik op kroegen, wijkfilter, prijsformulier met glasmaat, "Klopt deze kroeg niet" (gesloten, verkeerde plek, dubbel), account verwijderen, uitleg bij het eerste bezoek, PNG-pictogrammen. |
| #12 | Menukaartprijzen tellen mee in koers en Pilsindex, maar niet als melding. Ander bier weg uit de app, behalve Guinness (eigen groene stand). Beheerder kan elke tekst aanpassen (`app_teksten`, `zet_tekst`). Ontwerp naar Apple. Lokale vision-modellen voor menukaartfoto's (`docs/lokale-vision.md`, `menufotos.mjs --lokaal`). |

Kjell heeft daarna zelf vier werkregels aan `CLAUDE.md` toegevoegd (eerst lezen, dan wijzigen; alleen bouwen wat gevraagd is; na afloop kijken of het eenvoudiger kan).

## Volgende stappen

### Voor Kjell (dashboards, zie `ACTIES.md`)

1. **GitHub:** standaardbranch op `main` zetten. Daarna de oude branches verwijderen: `ux/gebruik-en-kaart` en de 7 oude sessiebranches. Ze zijn allemaal al in `main` opgenomen of bewust niet overgenomen. Een sessie kan ze niet verwijderen (de proxy geeft 403).
2. **Domein:** DNSSEC weer aanzetten via Cloudflare en de DS-record bij Vimexx zetten. Supabase, URL Configuration: Site URL `https://bierkoers.nl` en `https://bierkoers.nl/**` bij de Redirect URLs.
3. **Inloggen:** anonieme accounts en manual linking aan, mailtemplates met code, eigen SMTP. Zonder SMTP krijgen alleen teamleden een mail. Onderwerp van de mail: `Je code voor Bierkoers`.
4. **DeepSeek:** nieuwe sleutel aanmaken (de oude stond in een chat) en tegoed opwaarderen voor een run over heel Nijmegen.

### Voor een volgende sessie (alleen na akkoord van Kjell)

1. **Proef met lokale vision-modellen.** Op de computer van Kjell, met Claude Code daar (`docs/lokale-vision.md`, "Eerst meten"): Café Daen en Stadscafé Jan, daarna tien kroegen lokaal tegen DeepSeek. Uitkomst noteren in dat document.
2. **Betrouwbaarheid.** Kjell is nog niet tevreden over de regel uit `20261106220000_betrouwbaarheid_verwachting` (`docs/concept.md`, 2.6). Wacht op zijn voorstel.
3. **Later:** captcha (Turnstile) bij anonieme accounts, oude anonieme accounts opruimen, ideeën in `docs/kroegentocht.md` en `docs/toekomstplannen.md`.

## Valkuilen

- Werk altijd vanaf de nieuwste `main`. Een branch die lang blijft liggen, botst met `app/app.js`; dat is precies wat er met PR #13 gebeurde.
- Force push wordt geweigerd. Zet de werkbranch na een merge gelijk met `git checkout -B <branch> origin/main`; een gewone push werkt dan, omdat het een fast-forward is.
- Migraties via MCP `apply_migration` wachten op bevestiging van Kjell en kunnen verlopen. Zet de versie daarna gelijk aan de bestandsnaam en draai de Security Advisor.
- Verhoog `CACHE` in `app/sw.js` (nu `bierkoers-v15`) bij elke wijziging aan de app-schil.
