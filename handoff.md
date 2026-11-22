# Overdracht

Stand van 22 november 2026, voor de volgende sessie. Lees eerst `CLAUDE.md` (werkafspraken) en `ACTIES.md` (wat alleen de beheerder kan doen, en hoe alles is ingesteld).

## 1. In het kort

- De app draait op bierkoers.nl. `main` is de basis; werk vanaf de nieuwste `main` en lever op met een pull request. Mergen doet de beheerder.
- Nijmegen: 161 open kroegen, 22 in kaart (2 bevestigd, 4 spelermeldingen, 16 menukaartprijzen). Pilsindex € 3,90.
- Wat uit bronnen te halen valt, is binnen: eigen websites (DAEN) en foto's in Google Maps (JAN) zijn allebei doorzocht. De rest van de kaart komt van spelers ter plaatse.
- 22 november: pagina Over Bierkoers (link onderaan Ik, `overView()` in `app/app.js`) met credits voor Guindex en Divebar Database. De repository is openbaar en opgeschoond: werknotities neutraal, oude prompts weg (zie `CLAUDE.md`, Werkwijze).

## 2. Repository en tests

- `npm run check` en `npm run test:db` (`database.test.mjs` en `melding-mail.test.mjs`). De tools: `cd tools/google-kroegen && node --test test/*.test.mjs` (met `jpeg-js` en `tesseract.js` geïnstalleerd, zie punt 4).
- Geen CI behalve de build van Cloudflare Pages; die geeft per pull request een preview.
- Service worker `CACHE`: `bierkoers-v62`.
- Laatste migratie: `20261122150000_uitschieters`.

## 3. Open punten in het ontwerp

- **Punten voor foto's**: 5 per kroeg per speler, zonder beoordeling; de bucket is openbaar en moderatie gaat alleen met de SQL in `ACTIES.md`.
- **Vervangen**: twee e-mailaccounts kunnen elkaars melding vervangen voor +30, begrensd op 5 per speler per dag.
- **Een eigen melding vervangen** (typefout) kan niet; niet gebouwd zonder akkoord.
- **Betrouwbaarheid**: voorlopig, zie `docs/concept.md`, 2.6.

## 4. Valkuilen in de cloudsessie

- **DDL via de Supabase-connector** vraagt om een bevestiging in de app. Werkwijze zonder die vraag: `supabase/README.md`, Migratie uitvoeren vanuit een sessie.
- **Fotomethode met DeepSeek**: draai met `NODE_USE_ENV_PROXY=1` (anders gaat Node buiten de proxy om en krijgt DeepSeek geen sleutel: HTTP 401). Installeer in `tools/google-kroegen` alleen `npm install --no-save --no-package-lock jpeg-js@0.4.4 tesseract.js@6.0.1`, en maak `node_modules/playwright` en `node_modules/playwright-core` koppelingen naar `/opt/node-tools/node_modules/...`; de vastgepinde Playwright 1.48 vindt de vooraf geïnstalleerde browser niet. `node_modules` staat niet in Git.
- **Browser**: Playwright en Chromium staan klaar. Test de app met `python3 -m http.server 8765 --directory app` op telefoonbreedte; lokaal geeft `POST /api/sessie` een 501 (de Python-server kent geen POST), geen fout van de app. Bootst schrijfacties na met `page.route`, of ruim testdata in productie direct op. In de app sluit je de uitleg met `#intro button`, open je een kroeg via het zoekveld `input[data-zoek]` en kies je een tabblad met `#tabs button[data-tab="ik"]`.
- **Lange taken**: gebruik `run_in_background` en volg met een Monitor; een sessie kan halverwege herstarten. Push daarom tussendoor.
- Scripts uit eerdere sessies (crawler, Playwright-ronde, deelplaatje) stonden in de scratchpad en zijn weg; schrijf ze opnieuw als je ze nodig hebt.

## 5. Aanbevolen volgende stappen

1. Als de eerste spelers op echte telefoons hebben gespeeld: vragen wat er misging, en dat oplossen.
2. Als de beheerder punten uit `ACTIES.md` heeft gedaan: live controleren (bijvoorbeeld inloggen met Google buiten de testgebruikers) en het punt uit `ACTIES.md` halen.
3. De twijfelgevallen in de kroegenlijst nagaan zodra er meldingen of check-ins zijn.
4. Over een paar maanden de eigen websites (DAEN) opnieuw doorzoeken op nieuwe drankkaarten (`docs/menukaartprijzen.md`, Werkwijze in het kort).
