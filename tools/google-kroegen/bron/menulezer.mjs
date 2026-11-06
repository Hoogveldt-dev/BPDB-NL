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

/** Opgeteld verbruik van deze run (verzoeken en tokens). */
export const verbruik = { verzoeken: 0, in: 0, uit: 0 };

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

// denken: false zet het nadenken van het model uit. Voor ja/nee-vragen (herkennen,
// controleren) scheelt dat honderden tot duizenden tokens per verzoek; voor het lezen
// van prijzen laten we het (laag) aan, want zonder nadenken leest het model slordig.
async function vraag(afbeeldingen, tekst, { model = STANDAARD_MODEL, maxTokens = 8000, denken = true, log = () => {} } = {}) {
  const content = [
    ...afbeeldingen.map((b) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b.toString("base64")}` } })),
    { type: "text", text: tekst },
  ];
  const res = await fetch(`${model.url.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${model.sleutel}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model.model,
      max_tokens: maxTokens,
      ...(denken ? { reasoning_effort: "low" } : { thinking: { type: "disabled" } }),
      messages: [{ role: "user", content }],
    }),
    signal: AbortSignal.timeout(180000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Model gaf HTTP ${res.status}: ${body.slice(0, 300)}`);
  const d = JSON.parse(body);
  log(`    model: ${d.usage?.prompt_tokens ?? "?"} tokens in, ${d.usage?.completion_tokens ?? "?"} uit`);
  verbruik.verzoeken += 1;
  verbruik.in += d.usage?.prompt_tokens || 0;
  verbruik.uit += d.usage?.completion_tokens || 0;
  if (d.choices?.[0]?.finish_reason === "length") log("    let op: antwoord afgekapt (maximum aantal tokens bereikt)");
  return haalJson(d.choices?.[0]?.message?.content);
}

/** Geeft de indexen (vanaf 0) van de afbeeldingen die op een kaart lijken. */
export async function herkenMenus(miniaturen, opties) {
  const antwoord = await vraag(miniaturen, HERKEN, { ...opties, maxTokens: 4000 });
  const nummers = Array.isArray(antwoord?.menu) ? antwoord.menu : [];
  return [...new Set(nummers.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= miniaturen.length))].map((n) => n - 1);
}

const HERKEN_BLAD = (n) => `Dit is een raster van ${n} foto's van een café, elk met een geel nummer linksboven.
Op welke nummers is een drankkaart, menukaart, prijslijst of krijtbord met prijzen te zien, ook als die klein in beeld is (bijvoorbeeld een krijtbord aan de muur achter de bar)?
Niet: alleen eten, glazen, flessen of een QR-code. Antwoord alleen met JSON: {"menu": [nummers]}`;

/** Ruime eerste schifting op een contactblad met n genummerde miniaturen, zonder nadenken. */
export async function herkenOpBlad(blad, n, opties) {
  const antwoord = await vraag([blad], HERKEN_BLAD(n), { ...opties, denken: false, maxTokens: 300 });
  const nummers = Array.isArray(antwoord?.menu) ? antwoord.menu : [];
  return [...new Set(nummers.map(Number).filter((x) => Number.isInteger(x) && x >= 1 && x <= n))].map((x) => x - 1);
}

const CONTROLE = `Staan op deze foto prijzen van bier die je kunt lezen (merk of soort bier met een bedrag)? Antwoord alleen met JSON: {"bierprijzen": true/false}`;

/** Snelle controle per kandidaat, zonder nadenken: zijn er bierprijzen te lezen? */
export async function heeftBierprijzen(foto, opties) {
  const antwoord = await vraag([foto], CONTROLE, { ...opties, denken: false, maxTokens: 100 });
  return antwoord?.bierprijzen === true;
}

/** Leest de bieren van een kaart. */
export async function leesKaart(foto, opties) {
  const antwoord = await vraag([foto], LEES, opties);
  if (!antwoord || antwoord.leesbaar === false) return { bieren: [], datumOpKaart: null };
  return { bieren: Array.isArray(antwoord.bieren) ? antwoord.bieren : [], datumOpKaart: antwoord.datum_op_kaart || null };
}
