# Overdracht: menukaartproject naar de pc van Kjell

Stand op 9 november 2026, avond. Deze overdracht is voor een Claude Code-sessie die **op de Windows-pc van Kjell** draait, zodat LM Studio (Gemma, Qwen) en een thuisverbinding naar Google Maps bereikbaar zijn. Lees daarna `CLAUDE.md` (werkwijze en afspraken) en `ACTIES.md`.

## 0. Starten op de pc (voor Kjell)

De repo staat alleen op GitHub; de pc-sessie heeft een lokale kopie nodig.

1. Installeer, als dat nog niet is gebeurd: **Git** (git-scm.com), **Node.js 22 LTS** (nodejs.org) en de **Claude-app voor Windows** (claude.ai/download). LM Studio staat er al.
2. Open de Claude-app, tabblad **Code**, en kies een lokale map om in te werken, bijvoorbeeld `Documenten`. (Of: open PowerShell en typ `npm install -g @anthropic-ai/claude-code`, daarna `claude` in die map.)
3. Plak dit als eerste bericht:

```text
Clone https://github.com/Hoogveldt-dev/BPDB-NL naar deze map, open de map BPDB-NL en lees docs/overdracht.md. Voer daarna stap 1 tot en met 4 van die overdracht uit en meld je bij mij.
```

4. Wil je de sessie daarna vanaf je tablet besturen: typ in de sessie `/remote-control` (of start in een terminal in de map BPDB-NL `claude remote-control`). De sessie verschijnt dan in de Claude-app op de tablet en blijft op de pc draaien. Laat de pc aan en zet slaapstand uit.

Geef de sessie de rechten die ze vraagt voor commando's in deze map (Git, Node, curl naar localhost). Sleutels (Supabase service_role) zet je zelf in je terminal of een `.env` buiten Git, nooit in de chat.

## 1. Omgeving controleren (sessie)

- `git status` en `git log --oneline -3`: de laatste merge op `main` is PR #21.
- In `tools/google-kroegen`: `npm install` (zet ook `jpeg-js` en `tesseract.js` erbij) en `npx playwright install chromium`. Daarna `npm test`: 65 geslaagd verwacht.
- LM Studio: `curl http://localhost:1235/v1/models`. Verwacht: `qwen/qwen3.5-9b`, `google/gemma-4-e4b`, `qwen2.5-vl-7b-instruct`. Draait de server niet: vraag Kjell in LM Studio, tabblad Developer, de server op poort **1235** te starten met Just-in-time loading aan.
- Supabase: de pc-sessie heeft mogelijk geen Supabase-koppeling. Lezen kan altijd via de REST-API met de publishable key uit `app/config.js`. Importeren gaat met `SUPABASE_URL` en `SUPABASE_SERVICE_ROLE_KEY` in de omgeving van Kjell (zie `verwerk-oordelen.mjs --naar-supabase`); vraag Kjell die te zetten als het zover is, nooit in de chat.

## 2. Wat er al is (9 november 2026)

Gemerged: PR #15 tot en met #21.

| Onderdeel | Waar |
|---|---|
| Testset (labels, foto's ophalen, meten per stap) | `tools/google-kroegen/testset/` |
| LM Studio met drie rollen: schifter en kijker `google/gemma-4-e4b`, lezer `qwen/qwen3.5-9b`; controle van `/v1/models`; `<think>` eraf | `bron/menulezer.mjs`, `docs/lokale-vision.md` |
| Goedkope filters: dubbele foto's (dHash), OCR (standaard `--ocr volgorde`), vaste controles (prijs 2,00 tot 7,50, 30% van de mediaan, EXIF-datum, ouder dan 10 jaar) | `bron/beeld.mjs`, `bron/ocr.mjs`, `bron/controles.mjs` |
| Nakijken: uitsnede van de prijsregel, `nakijken/<datum>/`, subagent `menukaart-controleur` (Haiku), `verwerk-oordelen.mjs` | `bron/nakijken.mjs`, `.claude/agents/menukaart-controleur.md` |
| Managerprompt | `docs/menukaart-manager.md` |
| Datumregel voor de eigen website: EXIF, datum op de kaart, wijzigingsdatum van pagina of bestand; nooit de dag van bekijken | `docs/menukaartprijzen.md`, DAEN stap 4 |

**Nog nooit gedraaid op echte foto's of met LM Studio.** Alle code is getest met nagebootste antwoorden. De standaardmodellen en `--ocr volgorde` zijn voorlopige keuzes.

## 3. In de database

Vijf menukaartprijzen via de eigen websites (DAEN), elk goedgekeurd door de subagent en de vaste controles, status `wacht` (onder de mist):

| Kroeg (id) | Vaasje | Datum | Bron van de datum |
|---|---|---|---|
| Café Wunderkammer (56) | Grolsch € 3,80 | 2026-09-09 | upload van de kaartafbeelding (geen EXIF) |
| De Kluizenaar (31) | Mokum Bier Pilsener € 3,80 | 2026-10-05 | Webflow `Last Published` |
| Café Faber (42) | Heineken € 3,90 | 2026-06-16 | WordPress `modified` |
| Café Lux (5) | Grolsch € 3,90 | 2026-10-07 | `dateModified` |
| Brouwerij Florijn (107) | Heineken € 3,90 | 2026-09-23 | WordPress `modified` (DNB is hun eigen blond, geen pils) |

Afgevallen: Café Maxim (alleen Brand 22 cl), Café Jos (geen prijzen online). Stadscafé Jan heeft nog geen `google_place_id`.

## 4. Eerste opdracht op de pc: meten

Zonder meting weten we niet of de lokale modellen goed lezen. Volg `tools/google-kroegen/testset/README.md`:

1. `node testset/haal-fotos.mjs --kandidaten ChIJFSh-pl4Ix0cRlzqTtoR2B_4` (St. Anneke) en `--kandidaten ChIJiXxxslwIx0cRxyRGj-BgaWw` (Café Van Buren). Bekijk `overzicht.html` zelf (je kunt afbeeldingen lezen) en stel Kjell per kroeg een paar foto-ID's voor: het krijtbord, de QR-bordjes, en foto's zonder kaart. **Vul nooit zelf een prijs in als label**; leg de foto's aan Kjell voor of laat hem ze in `labels.json` zetten met `gecontroleerd: true`. Doel: ongeveer twintig labels.
2. `node testset/haal-fotos.mjs`, daarna de vier vergelijkingen uit `docs/lokale-vision.md` (Meten). Zet de uitslag in de tabel daar en pas de standaardmodellen aan als een ander model beter is.
3. Kijk naar de regel `ocr`: mist OCR geen echte kaarten, stel dan voor `--ocr filter` de standaard te maken.

Spelregels voor Google blijven gelden: een kroeg tegelijk, ongeveer 3 seconden tussen verzoeken, bij een CAPTCHA stoppen, niet opnieuw proberen, nooit een CAPTCHA oplossen.

## 5. Daarna: de manager

Gebruik `docs/menukaart-manager.md` met de scope die Kjell kiest. Kjell wil zo min mogelijk zelf doen; importeren mag automatisch als de controleur goedkeurt en alle vaste controles slagen, tenzij Kjell anders zegt.

## 6. Open wensen van Kjell

- **Minder Haiku, meer lokaal.** Het nakijken kostte ongeveer 12.000 tokens per geval met de subagent. Voorstel (nog niet gebouwd, eerst akkoord vragen): `verwerk-oordelen.mjs` of een nieuw script laat eerst Gemma of Qwen als controleur oordelen (zelfde JSON als de subagent), en alleen bij twijfel of onenigheid gaat het geval naar de subagent.
- **Foto's van Google Zoeken.** Het fotopaneel in Google Zoeken toont dezelfde foto's als Google Maps (het `ik:`-ID in de link is een Maps-foto-ID). `menufotos.mjs` haalt die al via Maps; geen aparte route nodig.
- **Categorie Menu in Google Maps** (`docs/menukaartprijzen.md`, Onderzoek): met de netwerktab van Chrome uitzoeken of `hspqX` alleen menufoto's kan ophalen.
- **Opruimen** (`ACTIES.md`): standaardbranch op `main` zetten en de oude werkbranches verwijderen; alle branches tot en met `claude/menukaart-7-datum` zitten in `main`.

## Lessen van deze dag

- Een cloudsessie kan `localhost` op de pc niet bereiken, en Google Maps aansturen werd daar geweigerd. Alles met LM Studio of Google hoort in de pc-sessie.
- `bron_omschrijving` mag hoogstens 80 tekens zijn (`supabase/migrations/20261106200000_menukaartprijzen.sql:19`); `naarMenuImport` houdt zich daar nu aan.
- Een menukaartprijs krijgt de datum van de kaart, niet de dag van het bekijken.
- Platte tekst van een webpagina kan de koppeling tussen prijs en maat kwijtraken (De Kluizenaar); geef de controleur dan de opbouw van de pagina.
- Werk vanaf de nieuwste `main`, een korte branch per onderdeel, en een pull request naar `main`. Force push wordt geweigerd.
