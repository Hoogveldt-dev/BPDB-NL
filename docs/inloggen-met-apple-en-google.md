# Inloggen met Apple en Google: stappenplan

De knoppen staan klaar in de app, met een slotje en "Binnenkort". De app vraagt bij het opstarten aan Supabase welke manieren van inloggen aanstaan (`/auth/v1/settings`, openbare instellingen). Zet je Google of Apple in Supabase aan, dan gaat het slotje vanzelf weg; er hoeft geen code te veranderen. Zet een aanbieder dus pas aan als alle stappen hieronder klaar zijn.

Supabase-project: `yzaootlrhxzyxtvacrot`. Terugkeeradres van Supabase voor Apple en Google:

```
https://yzaootlrhxzyxtvacrot.supabase.co/auth/v1/callback
```

## Hoe het werkt

| | Zonder account | Anonieme speler |
| --- | --- | --- |
| Google | Hele pagina naar Google en terug; bestaand account, of een nieuw als er nog geen is | Hetzelfde; daarna gaan de bijdragen van de anonieme speler naar dat account |
| Apple | Idem, via de webpagina van Apple | Idem |

- Code: `aanbiederKnoppen()`, `inloggenMet()` en `laadAanbieders()` in `app/app.js`. Beide knoppen heten "Doorgaan met" en gebruiken altijd `signInWithOAuth`, ook voor een anonieme speler: vooraf bewaart `onthoudAnoniem()` diens token en na terugkomst zet `samenvoegen()` (Edge Function `samenvoegen`) zijn bijdragen over. Geen `linkIdentity`: dat weigert als het Google-account al bij een speler hoort. Staat een aanbieder in Supabase uit, dan staat zijn knop op slot. Terug in de app staat `?code=` in de adresbalk; supabase-js wisselt die zelf in (PKCE).
- Een nieuwe speler via Apple of Google heet eerst "speler" en kiest onder Ik zelf een naam. We nemen bewust niet de naam van Google of Apple over: de ranglijst is openbaar.

## Stap 1. Supabase

Authentication, URL Configuration:

- Site URL: `https://bpdb-nl.pages.dev`
- Redirect URLs: `https://bpdb-nl.pages.dev/**` en `http://localhost:8765/**`

Authentication, Sign In / Providers: **Allow manual linking** is voor Apple en Google niet meer nodig (wel voor het koppelen van een e-mailadres aan een anonieme speler).

## Stap 2. Google (kan zonder betaald account)

1. Ga naar [console.cloud.google.com](https://console.cloud.google.com) en maak een project "Bierkoers".
2. Google Auth Platform, Branding (het toestemmingsscherm): type Extern, app-naam "Bierkoers", een e-mailadres voor ondersteuning, de startpagina `https://bpdb-nl.pages.dev` en een link naar een privacyverklaring. Die heeft Bierkoers nog niet; zie Open punten. Bij Authorized domains: `yzaootlrhxzyxtvacrot.supabase.co` en `bpdb-nl.pages.dev`.
3. Data Access: scopes `openid`, `.../auth/userinfo.email` en `.../auth/userinfo.profile`. Meer is niet nodig.
4. Clients, Create client: type Webapplicatie. Authorized JavaScript origins: `https://bpdb-nl.pages.dev` en `http://localhost:8765`. Authorized redirect URIs: het terugkeeradres van Supabase hierboven.
5. Kopieer Client ID en Client secret naar Supabase: Authentication, Sign In / Providers, Google. Zet Google aan en sla op. Vanaf nu staat de knop in de app open.
6. Audience: zet de app op In production. Zolang hij op Testing staat, kunnen alleen testgebruikers die je daar toevoegt inloggen.

## Stap 3. Apple (lidmaatschap Apple Developer Program nodig)

1. [developer.apple.com/account](https://developer.apple.com/account), Certificates, Identifiers & Profiles, Identifiers: maak een App ID (bijvoorbeeld `nl.bpdb.kroegkaart`) met de functie Sign in with Apple.
2. Maak een Services ID (bijvoorbeeld `nl.bpdb.kroegkaart.web`). Zet Sign in with Apple aan, kies bij Configure de App ID uit stap 1, vul bij Domains `yzaootlrhxzyxtvacrot.supabase.co` in en bij Return URLs het terugkeeradres van Supabase.
3. Keys: maak een sleutel met Sign in with Apple en download het `.p8`-bestand. Noteer de Key ID en je Team ID. Zet het `.p8`-bestand nooit in de app of in Git.
4. Supabase, Authentication, Sign In / Providers, Apple: vul bij Client IDs de Services ID in en maak met de Key ID, Team ID en het `.p8`-bestand de geheime sleutel (Supabase legt bij de aanbieder uit hoe). Zet Apple aan. Vanaf nu staat de knop in de app open.
5. Let op: deze geheime sleutel verloopt na hoogstens 6 maanden. Zet een herinnering om hem op tijd te vernieuwen, anders werkt inloggen met Apple ineens niet meer.

## Stap 4. Testen

- Op een computer: `python3 -m http.server 8765 --directory app` en open http://localhost:8765.
- Op een iPhone, ook vanaf het beginscherm (de PWA). Daar kan terugkomen van Google of Apple in Safari belanden in plaats van in de app; controleer dat je daarna in de app bent ingelogd.

## Open punten

- **Privacyverklaring.** Google vraagt om een link naar een privacyverklaring, en die hoort er sowieso te zijn zodra we e-mailadressen bewaren. BPDB heeft er nog geen.
- **18 jaar of ouder.** Wie met Apple of Google begint, vinkt nu niet aan dat hij 18 of ouder is. Overweeg die vraag na de eerste keer inloggen te stellen.
