# Foto's van cafés doorzoeken met lokale vision-modellen

Kjell draait vision-modellen op zijn eigen computer in **LM Studio**. Ze kosten niets per foto en hebben geen limiet. Daarmee kunnen we alle foto's van alle kroegen doorzoeken in plaats van een handvol per kroeg.

Waar dit voor is: de JAN-methode (`docs/menukaartprijzen.md`), dus menukaartfoto's in Google Maps vinden, lezen en dateren. De uitkomst blijft een **menukaartprijs**: een hint bij de kroeg, met de mist erover. Menukaartprijzen tellen mee in de koers en de Pilsindex, maar zijn geen melding: ze staan niet in "Laatste meldingen" en niet in de activiteit van de lichtkrant.

## Modellen

Gedownload in LM Studio (9 november 2026; controleer met `lms ls` of `GET http://localhost:1235/v1/models`):

| Model in LM Studio | Ziet beelden | Nadenken | Context | Opmerking |
|---|---|---|---|---|
| `qwen/qwen3.5-9b` | ja | ja | 262k | standaard lezer |
| `google/gemma-4-e4b` | ja | ja | 131k | standaard schifter en kijker; andere modelfamilie dan Qwen |
| `qwen2.5-vl-7b-instruct` | ja | nee | | kan de plek van tekst op de foto teruggeven (coördinaten) |
| `text-embedding-nomic-embed-text-v1.5` | nee | | | alleen tekst, hier niet nodig |

Llama 3.2 Vision staat niet meer in de standaardinstelling: het is niet gedownload.

## Wie doet wat

| Stap | Rol (variabele) | Standaard | Grootte van de foto |
|---|---|---|---|
| 1. Schiften: staat er een kaart of krijtbord op? | schifter (`LOKAAL_SCHIFTER`) | `google/gemma-4-e4b` | 256 px, per foto |
| 2. Controleren: staan er bierprijzen die je kunt lezen? | lezer (`LOKAAL_LEZER`) | `qwen/qwen3.5-9b` | 768 px |
| 3. Lezen: alle bieren met maat en prijs, met nadenken, temperatuur 0 | lezer (`LOKAAL_LEZER`) | `qwen/qwen3.5-9b` | 1600 px |
| 4. Kiezen: goedkoopste pils van de tap in 25 cl | geen model (`kiesVaasje`) | | |
| 5. Tweede mening: staat deze prijs echt op de kaart? | kijker (`LOKAAL_KIJKER`) | `google/gemma-4-e4b` | 1600 px |
| 6. Twijfels nakijken | Claude, of Kjell | | |

Zegt de tweede mening geen duidelijk "ja", of ziet het model een andere prijs, dan gaat de prijs naar `twijfels` in de uitvoer en niet naar de import. Liever geen prijs dan een verkeerde.

Oude namen blijven werken: zonder `LOKAAL_SCHIFTER` neemt de schifter `LOKAAL_KIJKER` over (vroeger schifte de kijker).

Lokaal schiften we elke foto apart in plaats van op een contactblad van 20 miniaturen. Een foto kost niets, en een klein model leest de nummers op een contactblad slecht.

### Modellen die nadenken

Qwen3.5 en Gemma 4 schrijven eerst redeneertekst, soms tussen `<think>` en `</think>`, soms zonder openingstag. De tool haalt die eraf en leest het eerste geldige JSON-blok (`zonderDenken` en `haalJson` in `tools/google-kroegen/bron/menulezer.mjs`). Lokaal krijgt elk antwoord minstens 8.192 tokens, zodat de JSON er na het nadenken nog bij past. Kapt het model toch af midden in het nadenken, dan telt het als geen antwoord.

## Installeren

1. LM Studio, tabblad Developer: zet de server aan op **poort 1235** (niet de standaard 1234).
2. Laat "Just-in-time model loading" aan: LM Studio laadt een model bij de eerste aanroep. Dat kan een paar minuten duren; de tool wacht per verzoek tot 15 minuten (`LOKAAL_TIMEOUT_MS`).
3. Controleer de namen:

```bash
curl http://localhost:1235/v1/models
```

Bij de start controleert de tool met `/v1/models` of de gekozen modellen er zijn. Zo niet, dan noemt hij het ontbrekende model en de beschikbare namen.

- **Geheugen.** Past niet alles tegelijk, dan wisselt LM Studio de modellen; dat is trager maar werkt.
- **Geen geheugen meer bij het lezen?** Zet in `bron/fotos.mjs` bij `leesbaar` de standaardmaat lager (1280 in plaats van 1600).
- **Ollama** werkt ook: `LOKAAL_URL=http://localhost:11434/v1`, met de modelnamen zoals `ollama list` ze toont in `LOKAAL_SCHIFTER`, `LOKAAL_LEZER` en `LOKAAL_KIJKER`.

## Draaien

Vanaf een thuisverbinding, in de map `tools/google-kroegen`:

```bash
npm install
node cli.mjs --gemeentecode GM0268                   # lijst met kroegen uit Google (Nijmegen), als die er nog niet is
node menufotos.mjs --kroegen google-kroegen-nijmegen.json --lokaal --volledig --max-fotos 400 --uit menuprijzen.json
```

- `--lokaal`: de stappen hierboven, met de lokale modellen.
- `--volledig`: niet stoppen bij de eerste prijs, maar alle foto's bekijken. Zo vinden we de nieuwste kaart.
- De uitvoer heeft per kroeg `prijs` (beide modellen eens) en `twijfels` (nakijken).
- Importeren gaat met `--naar-supabase` en de `service_role`-sleutel in `SUPABASE_SERVICE_ROLE_KEY`. Die sleutel staat alleen op de computer van Kjell, nooit in Git of in een chat.

Een onbeperkt model betekent niet dat Google onbeperkt is. De spelregels uit `docs/menukaartprijzen.md` blijven gelden: een kroeg tegelijk, ongeveer 3 seconden tussen verzoeken, een run per paar maanden, en bij een CAPTCHA stoppen.

## Meten

Met de testset (`tools/google-kroegen/testset/README.md`) meten we per stap hoe vaak een model goed zit. Minstens deze vier vergelijkingen:

```bash
node testset/meet.mjs --lezer qwen/qwen3.5-9b --naam lezer-qwen35
```

```bash
node testset/meet.mjs --lezer qwen2.5-vl-7b-instruct --naam lezer-qwen25vl
```

```bash
node testset/meet.mjs --kijker google/gemma-4-e4b --naam kijker-gemma4
```

```bash
node testset/meet.mjs --kijker qwen2.5-vl-7b-instruct --naam kijker-qwen25vl
```

Voor de lezer tellen de regels `controleren`, `lezen` en `kiezen`, voor de kijker `kiezen` en `keten` (een goede kijker maakt van een foute prijs een twijfel, en laat een goede prijs door). Ook de schifter is te vergelijken met `--schifter`.

### Uitslag

**Nog niet gemeten.** De sessie van 9 november 2026 draaide in de cloud en kon LM Studio niet bereiken; de testset heeft ook nog geen foto's. De standaarden hierboven komen uit de opdracht, niet uit een meting. Na de meting hier per vergelijking het aantal goed, fout, gemist en twijfel en de seconden per foto noteren, en de standaard aanpassen als een ander model beter is.

| Vergelijking | controleren | lezen | kiezen | keten | s per foto |
|---|---|---|---|---|---|
| lezer Qwen3.5 9B | | | | | |
| lezer Qwen2.5-VL 7B | | | | | |
| kijker Gemma 4 E4B | | | | | |
| kijker Qwen2.5-VL 7B | | | | | |

Daarna, zoals eerder afgesproken: tien kroegen lokaal tegen dezelfde tien met DeepSeek, en noteren hoeveel prijzen gelijk zijn, hoeveel er alleen lokaal of alleen bij DeepSeek uitkomen, en hoeveel twijfels er zijn.

## Hoe Claude meewerkt

De lokale modellen draaien op de computer van Kjell; een cloudsessie van Claude kan `localhost` daar niet bereiken. Er zijn drie manieren:

1. **Claude Code op de eigen computer (aanbevolen).** Open de repo in de Claude-app op de computer, of start `claude` in een terminal. Die sessie kan LM Studio op `localhost` aanroepen, de tool en de testset draaien, de twijfels nakijken en de import klaarzetten. Zo blijft alles op de eigen computer.
2. **Remote Control vanuit een cloudsessie.** In de Claude-app op de computer: Instellingen, Claude Code, Remote Control, en daar de map van de repo delen. Een cloudsessie kan dan opdrachten op de computer uitvoeren. Op 9 november 2026 stond er nog geen map klaar.
3. **Niet doen: de server van LM Studio of Ollama openzetten naar internet** (met een tunnel of door de poort open te zetten). Er zit geen wachtwoord op; iedereen die het adres vindt, gebruikt dan de videokaart en kan de modellen wisselen.

Werkverdeling: de lokale modellen doen het grote werk (duizenden foto's). Claude kijkt alleen de twijfels na (meestal een paar per stad), vergelijkt ze met de foto en zet de rijen voor `importeer_menuprijzen` klaar. Kjell importeert.

## Eerst meten

Voor een hele stad eerst een proef met kroegen waarvan we de prijs al weten (ook in de testset):

| Kroeg | Bekende prijs | Bron |
|---|---|---|
| Café Daen | Hertog Jan 25 cl €4,00 | drankkaart (pdf), 2 september 2026 |
| Stadscafé Jan | vaasje €3,90 | menufoto, 20 december 2025 |
