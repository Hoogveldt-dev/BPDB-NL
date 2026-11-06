// Menukaarten herkennen en uitlezen met een vision-model.
//
// Werkt met elke API in het OpenAI-formaat (chat/completions met image_url).
// Standaard DeepSeek (deepseek-flash, leest afbeeldingen). De sleutel komt uit
// DEEPSEEK_API_KEY; in een cloudsessie met een netwerkgeheim voegt de proxy hem toe
// en volstaat de standaardwaarde "proxy-injected". Zet een sleutel nooit in git.

export const STANDAARD_MODEL = {
  url: process.env.MENU_MODEL_URL || "https://api.deepseek.com",
  model: process.env.MENU_MODEL || "deepseek-flash",
  sleutel: process.env.DEEPSEEK_API_KEY || "proxy-injected",
};

const HERKEN = `Je ziet genummerde foto's van een café (nummer 1 is de eerste afbeelding).
Welke foto's tonen een drankkaart, menukaart of prijsbord waarop prijzen van bier leesbaar kunnen zijn?
Niet: eten, interieur, mensen, glazen zonder kaart, een QR-code zonder prijzen.
Antwoord alleen met JSON: {"menu": [nummers]}`;

const LEES = `Dit is een foto van een kaart in een Nederlands café. Lees alle bieren met hun prijs.
Antwoord alleen met JSON:
{"leesbaar": true/false,
 "datum_op_kaart": "tekst of null",
 "bieren": [{"merk": "Hertog Jan", "omschrijving": "zoals op de kaart", "cl": 25 of null, "prijs": 3.9, "tap": true/false/null, "pils": true/false}]}
Regels: "cl" alleen als de maat er staat (0,25l = 25; 0,5 = 50). Staan er twee prijzen voor twee maten ("0,25/0,5 4/8"), maak dan twee regels. "tap" is true bij "van de tap", "fust" of "tap"; false bij "fles". Verzin niets: wat je niet kunt lezen, laat je weg.`;

export function haalJson(tekst) {
  if (!tekst) return null;
  const zonderHek = tekst.replace(/```(?:json)?/g, "");
  const begin = zonderHek.indexOf("{");
  const eind = zonderHek.lastIndexOf("}");
  if (begin < 0 || eind <= begin) return null;
  try {
    return JSON.parse(zonderHek.slice(begin, eind + 1));
  } catch {
    return null;
  }
}

async function vraag(afbeeldingen, tekst, { model = STANDAARD_MODEL, maxTokens = 8000, log = () => {} } = {}) {
  const content = [
    ...afbeeldingen.map((b) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b.toString("base64")}` } })),
    { type: "text", text: tekst },
  ];
  const res = await fetch(`${model.url.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${model.sleutel}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: model.model, max_tokens: maxTokens, reasoning_effort: "low", messages: [{ role: "user", content }] }),
    signal: AbortSignal.timeout(180000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Model gaf HTTP ${res.status}: ${body.slice(0, 300)}`);
  const d = JSON.parse(body);
  log(`    model: ${d.usage?.prompt_tokens ?? "?"} tokens in, ${d.usage?.completion_tokens ?? "?"} uit`);
  if (d.choices?.[0]?.finish_reason === "length") log("    let op: antwoord afgekapt (maximum aantal tokens bereikt)");
  return haalJson(d.choices?.[0]?.message?.content);
}

/** Geeft de indexen (vanaf 0) van de afbeeldingen die op een kaart lijken. */
export async function herkenMenus(miniaturen, opties) {
  const antwoord = await vraag(miniaturen, HERKEN, { ...opties, maxTokens: 4000 });
  const nummers = Array.isArray(antwoord?.menu) ? antwoord.menu : [];
  return [...new Set(nummers.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= miniaturen.length))].map((n) => n - 1);
}

/** Leest de bieren van een kaart. */
export async function leesKaart(foto, opties) {
  const antwoord = await vraag([foto], LEES, opties);
  if (!antwoord || antwoord.leesbaar === false) return { bieren: [], datumOpKaart: null };
  return { bieren: Array.isArray(antwoord.bieren) ? antwoord.bieren : [], datumOpKaart: antwoord.datum_op_kaart || null };
}
