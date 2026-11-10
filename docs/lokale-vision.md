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
node menufotos.mjs --kroegen google-kroegen-nijmegen.json --volledig --max-fotos 400 --uit menuprijzen.json
```

- De lokale modellen zijn de standaard (sinds 10 november 2026); `--lokaal` hoeft niet meer. `--extern` gebruikt de betaalde DeepSeek, als reserve als LM Studio niet draait. Foto's ophalen bij Google kan alleen vanaf de thuisverbinding.
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

Gemeten op 10 november 2026, op de pc van Kjell (RTX 2080 Ti, 11 GB), met 22 foto's uit de testset. Claude koos de foto's en keek elk label na op de foto zelf. Van die 22 hebben er 4 een vaasjesprijs: drankkaarten van Daen en Wunderkammer (afbeelding van de eigen website) en schermafdrukken van de dranken-pagina's van De Kluizenaar en Florijn. De andere 18 zijn foto's uit Google Maps: krijtborden met alleen alcoholpercentages, een eetkaart met biernamen maar zonder bierprijzen, een kassabon, een donker krijtbord met flessen, QR-bordjes, eten en interieur. De foto van Stadscafé Jan ontbreekt nog (geen Google Place ID). Schifter in alle vier de vergelijkingen: Gemma 4 E4B.

Per stap: goed / fout / gemist / twijfel (de rest is nvt).

| Vergelijking | controleren | lezen | kiezen | keten | s per foto |
|---|---|---|---|---|---|
| lezer Qwen3.5 9B | 22 / 0 / 0 / 0 | 2 / 0 / 0 / 2 | 3 / 0 / 2 / 2 | 18 / 0 / 2 / 2 | 78 |
| lezer Qwen2.5-VL 7B | 6 / 1 / 3 / 12 | 2 / 1 / 1 / 0 | 4 / 0 / 4 / 0 | 18 / 0 / 4 / 0 | 29 |
| kijker Gemma 4 E4B (lezer Qwen3.5) | 22 / 0 / 0 / 0 | 2 / 0 / 0 / 2 | 3 / 0 / 2 / 2 | 18 / 0 / 2 / 2 | 77 |
| kijker Qwen2.5-VL 7B (lezer Qwen3.5) | 22 / 0 / 0 / 0 | 2 / 0 / 0 / 2 | 3 / 0 / 2 / 2 | 18 / 0 / 2 / 2 | 77 |

Schiften (Gemma 4 E4B): 14 goed, 8 fout, 0 gemist. Ruim, zoals bedoeld: geen kaart gemist, wel dichte kaarten, QR-bordjes en een kassabon doorgelaten.

Wat het zegt:

- **Geen enkele verkeerde prijs.** Geen model gaf bij kiezen of in de keten een foute prijs. De grens (hoogstens 1 op 20) is gehaald.
- **Maar ook geen enkele goede vaasjesprijs.** De keten vond bij geen van de 4 kaarten met een vaasje een prijs. De oorzaak zit vooral na het lezen: de lezer las bij Wunderkammer "Grolsch 0,25 3,8" goed, en Qwen2.5-VL las bij Daen "Hertog Jan 25 cl 4", maar beide zetten `pils: false` bij die regel (waarschijnlijk omdat er een aparte kop "Pils" op de kaart staat), en `kiesVaasje` (`bron/vaasje.mjs`) slaat een regel met `pils: false` over. Bij Florijn las Qwen3.5 "vaas 3.9" als 50 cl en niet van de tap: terecht geen prijs.
- **Qwen3.5 denkt zich vast op dichte kaarten.** Bij Daen en De Kluizenaar kwam er na ongeveer 3 minuten geen bruikbaar antwoord (twijfel).
- **Qwen2.5-VL is drie keer zo snel, maar onbetrouwbaar bij controleren** (12 keer geen bruikbaar antwoord, 1 keer fout) en geeft het vak van de prijsregel niet goed terug (twee getallen in plaats van vier).
- **De kijker is nog niet echt gemeten.** Hij komt pas in actie als de lezer een vaasjesprijs kiest, en dat gebeurde niet. De twee kijkerrijen zijn daarom gelijk.

Keuze per rol: alles blijft bij de standaard. Schifter Gemma 4 E4B, lezer Qwen3.5 9B (de enige die betrouwbaar controleert), kijker Gemma 4 E4B (geen meting die een ander model beter maakt).

Voorstel, nog niet gedaan: laat `kiesVaasje` een bekend pilsmerk van de tap in 25 cl niet weggooien alleen omdat het model `pils: false` zegt, en meet daarna opnieuw. Dat kan het aantal gevonden prijzen flink verhogen; de kijker en het nakijken vangen een fout dan op.

Daarna een proef op kroegen waarvan we de prijs al weten (de menukaartprijzen in de database, zie hieronder): noteren hoeveel prijzen lokaal gelijk uitkomen, hoeveel verschillen en hoeveel twijfels er zijn. De vergelijking met DeepSeek laten we vallen (besluit van Kjell, 10 november 2026): het doel is zonder betaalde modellen te werken.

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
