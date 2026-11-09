# Testset voor de menukaartpijplijn

Een vaste set foto's met labels die Kjell met de hand heeft gecontroleerd. Daarmee meten we per stap van de pijplijn (schiften, controleren, lezen, kiezen) hoe vaak een model goed zit, en kunnen we modellen en rollen vergelijken.

| Bestand | Wat |
|---|---|
| `labels.json` | Per foto: kroeg, `place_id`, `foto_id`, wat erop staat (`kaart`, `bierprijzen`), de verwachte vaasjesprijs (`vaasje` in euro, of `null`), de verwachte `datum` en een korte `omschrijving`. In Git. |
| `fotos/<sleutel>/` | De foto in vier maten (`256.jpg`, `768.jpg`, `1600.jpg`, origineel `s0.jpg`) en `meta.json`. **Niet in Git.** |
| `uitslagen/` | Uitslagen van `meet.mjs` als JSON. Niet in Git. |
| `haal-fotos.mjs` | Haalt de foto's op aan de hand van de ID's. |
| `meet.mjs` | Draait de pijplijn op de testset. |
| `score.mjs` | Wanneer een stap goed, fout, gemist of twijfel is. |

## Afspraken

- Kjell controleert elk label met de hand en zet dan `gecontroleerd` op `true`. Claude vult nooit zelf een prijs in als label.
- De foto's blijven op de eigen computer (rechten van de makers, voorwaarden van Google). In Git staan alleen ID's, prijs, datum en omschrijving.
- Doel: ongeveer twintig foto's, ook foto's zonder kaart (eten, interieur, QR-bordje), scheve en donkere foto's, krijtborden en gedrukte kaarten.

## Labels kiezen

Miniaturen van een kroeg bekijken, met ID en uploaddatum:

```bash
node testset/haal-fotos.mjs --kandidaten ChIJFSh-pl4Ix0cRlzqTtoR2B_4
```

Open daarna `testset/fotos/kandidaten/<place_id>/overzicht.html`, neem `place_id` en `foto_id` over in `labels.json` en vul de rest in. Bij `bron: "bestand"` (bijvoorbeeld de drankkaart van een website) zet je de afbeelding zelf in `fotos/<sleutel>/s0.jpg`; die wordt dan voor alle maten gebruikt.

Daarna de gekozen foto's ophalen:

```bash
node testset/haal-fotos.mjs
```

Dit opent Google Maps, dus de spelregels gelden: een kroeg tegelijk, ongeveer 3 seconden tussen verzoeken, en bij een CAPTCHA stopt het script. Draai het vanaf een thuisverbinding.

## Meten

```bash
node testset/meet.mjs --lezer qwen2.5-vl-7b-instruct --naam qwen25
```

Rollen: `--schifter` (staat er een kaart op?), `--lezer` (controleren en lezen), `--kijker` (tweede mening, `geen` om over te slaan), en `--url` voor de server. Het model `deepseek` gebruikt DeepSeek in plaats van een lokaal model. `--alleen jan-kaart,anneke-krijtbord` meet een deel.

De uitkomst komt als tabel in de terminal en als JSON in `uitslagen/`. Per stap:

| Uitslag | Betekenis |
|---|---|
| goed | zoals het label |
| fout | iets gezien wat er niet is, of een verkeerde prijs |
| gemist | niets gezien terwijl er wel iets is |
| twijfel | geen bruikbaar antwoord (geen JSON, time-out), of de prijs ging naar `twijfels` |
| nvt | deze stap zegt bij deze foto niets |

Elke stap wordt apart gemeten: ook als het schiften een kaart mist, wordt de foto gelezen, zodat je ziet welke stap het misdoet. De regel `keten` is wat de echte pijplijn zou opleveren (alleen wat door schiften en controleren komt), `datum` vergelijkt de EXIF-datum (anders de uploaddatum) met het label.
