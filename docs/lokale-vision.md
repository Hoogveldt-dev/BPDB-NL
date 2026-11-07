# Foto's van cafés doorzoeken met lokale vision-modellen

Kjell heeft twee vision-modellen op zijn eigen computer: **Qwen2.5-VL 7B Instruct** en **Llama 3.2 11B Vision Instruct**. Ze kosten niets per foto en hebben geen limiet. Daarmee kunnen we alle foto's van alle kroegen doorzoeken in plaats van een handvol per kroeg.

Waar dit voor is: de JAN-methode (`docs/menukaartprijzen.md`), dus menukaartfoto's in Google Maps vinden, lezen en dateren. De uitkomst blijft een **menukaartprijs**: een hint bij de kroeg, met de mist erover. Menukaartprijzen tellen mee in de koers en de Pilsindex, maar zijn geen melding: ze staan niet in "Laatste meldingen" en niet in de activiteit van de lichtkrant.

## Wie doet wat

| Stap | Model | Waarom dit model | Grootte van de foto |
|---|---|---|---|
| 1. Schiften: staat er een kaart of krijtbord op? | Llama 3.2 Vision | Goed in zien wat er op een foto staat; ruim, liever een foto te veel | 512 px, per foto |
| 2. Controleren: staan er bierprijzen die je kunt lezen? | Qwen2.5-VL | Leest kleine tekst en cijfers het best | 768 px |
| 3. Lezen: alle bieren met maat en prijs | Qwen2.5-VL | Idem; temperatuur 0 | 1600 px |
| 4. Kiezen: goedkoopste pils van de tap in 25 cl | geen model (`kiesVaasje`) | Vaste regels, geen gok | |
| 5. Tweede mening: staat deze prijs echt op de kaart? | Llama 3.2 Vision | Een ander model maakt andere fouten | 1600 px (Llama schaalt zelf terug naar 1120) |
| 6. Twijfels nakijken | Claude, of Kjell | Alleen waar de modellen het oneens zijn | |

Zegt de tweede mening geen duidelijk "ja", of ziet het model een andere prijs, dan gaat de prijs naar `twijfels` in de uitvoer en niet naar de import. Liever geen prijs dan een verkeerde.

Lokaal schiften we elke foto apart in plaats van op een contactblad van 20 miniaturen. Een foto kost niets, en een klein model leest de nummers op een contactblad slecht.

## Installeren

Met [Ollama](https://ollama.com) (aanbevolen):

```bash
ollama pull qwen2.5vl:7b
ollama pull llama3.2-vision:11b
ollama list          # beide moeten erin staan
```

Ollama luistert op `http://localhost:11434` en spreekt ook het OpenAI-formaat (`/v1/chat/completions`), dat de tool gebruikt.

- **Geheugen.** Qwen2.5-VL 7B neemt in 4 bits ongeveer 6 GB videogeheugen, Llama 3.2 Vision 11B ongeveer 8 GB, plus wat extra voor grote foto's. Past niet alles tegelijk, dan wisselt Ollama de modellen zelf; dat is trager maar werkt. Met 16 GB of meer: `OLLAMA_MAX_LOADED_MODELS=2`.
- **Geen geheugen meer bij het lezen?** Zet in `bron/fotos.mjs` bij `leesbaar` de standaardmaat lager (1280 in plaats van 1600).
- **LM Studio** werkt ook: zet de server aan en gebruik `LOKAAL_URL=http://localhost:1234/v1`, met de modelnamen zoals LM Studio ze toont in `LOKAAL_LEZER` en `LOKAAL_KIJKER`.

## Draaien

Vanaf een thuisverbinding, in de map `tools/google-kroegen`:

```bash
npm install
node cli.mjs --gemeentecode GM0268                   # lijst met kroegen uit Google (Nijmegen), als die er nog niet is
node menufotos.mjs --kroegen google-kroegen-nijmegen.json --lokaal --volledig --max-fotos 400 --uit menuprijzen.json
```

- `--lokaal`: de stappen hierboven, met de twee lokale modellen.
- `--volledig`: niet stoppen bij de eerste prijs, maar alle foto's bekijken. Zo vinden we de nieuwste kaart.
- De uitvoer heeft per kroeg `prijs` (beide modellen eens) en `twijfels` (nakijken).
- Importeren gaat met `--naar-supabase` en de `service_role`-sleutel in `SUPABASE_SERVICE_ROLE_KEY`. Die sleutel staat alleen op de computer van Kjell, nooit in Git of in een chat.

Een onbeperkt model betekent niet dat Google onbeperkt is. De spelregels uit `docs/menukaartprijzen.md` blijven gelden: een kroeg tegelijk, ongeveer 3 seconden tussen verzoeken, een run per paar maanden, en bij een CAPTCHA stoppen.

## Hoe Claude meewerkt

De lokale modellen draaien op de computer van Kjell; een cloudsessie van Claude kan `localhost` daar niet bereiken. Er zijn drie manieren:

1. **Claude Code op de eigen computer (aanbevolen).** Open de repo in de Claude-app op de computer, of start `claude` in een terminal. Die sessie kan Ollama op `localhost` aanroepen, de tool draaien, de twijfels nakijken en de import klaarzetten. Zo blijft alles op de eigen computer.
2. **Remote Control vanuit een cloudsessie.** In de Claude-app op de computer: Instellingen, Claude Code, Remote Control, en daar de map van de repo delen. Een cloudsessie kan dan opdrachten op de computer uitvoeren. Op 7 november 2026 stond er nog geen map klaar, en de functie is nog niet voor iedereen beschikbaar.
3. **Niet doen: Ollama openzetten naar internet** (met een tunnel of door de poort open te zetten). Ollama heeft geen wachtwoord; iedereen die het adres vindt, gebruikt dan de videokaart en kan de modellen wisselen.

Werkverdeling: de lokale modellen doen het grote werk (duizenden foto's). Claude kijkt alleen de twijfels na (meestal een paar per stad), vergelijkt ze met de foto en zet de rijen voor `importeer_menuprijzen` klaar. Kjell importeert.

## Eerst meten

Voor een hele stad eerst een proef met kroegen waarvan we de prijs al weten:

| Kroeg | Bekende prijs | Bron |
|---|---|---|
| Café Daen | Hertog Jan 25 cl €4,00 | drankkaart (pdf), 2 september 2026 |
| Stadscafé Jan | vaasje €3,90 | menufoto, 20 december 2025 |

Draai daarna tien kroegen met `--lokaal` en dezelfde tien met DeepSeek, en noteer hier hoeveel prijzen gelijk zijn, hoeveel er alleen lokaal of alleen bij DeepSeek uitkomen, en hoeveel twijfels er zijn. Vindt Qwen te vaak niets, laat Llama dan ook lezen en neem een prijs alleen als beide modellen hetzelfde lezen.
