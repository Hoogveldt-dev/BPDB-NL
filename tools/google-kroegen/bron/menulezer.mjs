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

// Lokale modellen op je eigen computer, standaard via LM Studio op poort 1235. Ollama werkt ook
// (LOKAAL_URL=http://localhost:11434/v1); beide spreken het OpenAI-formaat. Geen sleutel en geen limiet.
// Zie docs/lokale-vision.md. Drie rollen, elk met een eigen variabele:
//   schifter  LOKAAL_SCHIFTER, Gemma 4 E4B: staat er een kaart of krijtbord op?
//   lezer     LOKAAL_LEZER, Qwen3.5 9B: controleren en lezen, met nadenken, temperatuur 0.
//   kijker    LOKAAL_KIJKER, Gemma 4 E4B: tweede mening van een andere modelfamilie.
// Vroeger schifte de kijker; zonder LOKAAL_SCHIFTER neemt de schifter daarom LOKAAL_KIJKER over.
export const LOKAAL_URL = process.env.LOKAAL_URL || "http://localhost:1235/v1";
const lokaal = (model) => ({ url: LOKAAL_URL, model, sleutel: "lokaal", lokaal: true });
export const LOKAAL = {
  schifter: lokaal(process.env.LOKAAL_SCHIFTER || process.env.LOKAAL_KIJKER || "google/gemma-4-e4b"),
  lezer: lokaal(process.env.LOKAAL_LEZER || "qwen/qwen3.5-9b"),
  kijker: lokaal(process.env.LOKAAL_KIJKER || "google/gemma-4-e4b"),
};

// LM Studio laadt een model pas bij de eerste aanroep (JIT); dat kan minuten duren. Daarom ruim.
const LOKAAL_TIMEOUT_MS = Number(process.env.LOKAAL_TIMEOUT_MS) || 900000;
// Modellen die nadenken schrijven eerst redeneertekst; met te weinig tokens komt de JSON er niet meer bij.
// Lokaal kost een token niets, dus nooit minder dan dit.
const LOKAAL_MIN_TOKENS = 8192;

/**
 * Controleert bij de start of de gekozen lokale modellen bestaan (GET /v1/models).
 * Geeft een Nederlandse melding met de beschikbare namen als er een ontbreekt.
 */
export async function controleerModellen(modellen) {
  const lokale = modellen.filter((m) => m?.lokaal);
  const perUrl = new Map();
  for (const m of lokale) perUrl.set(m.url, [...(perUrl.get(m.url) || []), m.model]);
  for (const [url, namen] of perUrl) {
    let lijst;
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/models`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      lijst = ((await res.json()).data || []).map((d) => d.id);
    } catch (e) {
      throw new Error(`Geen lokale modelserver op ${url} (${e.message}). Start de server in LM Studio (Developer, Start server, poort 1235) of zet LOKAAL_URL goed.`);
    }
    const ontbreekt = [...new Set(namen)].filter((n) => !lijst.includes(n));
    if (ontbreekt.length) {
      throw new Error(`Model ${ontbreekt.join(", ")} staat niet op ${url}. Beschikbaar: ${lijst.join(", ") || "geen"}. Kies met LOKAAL_SCHIFTER, LOKAAL_LEZER of LOKAAL_KIJKER.`);
    }
  }
}

const HERKEN = `Je ziet genummerde foto's van een café (nummer 1 is de eerste afbeelding).
Welke foto's tonen een drankkaart, menukaart of prijsbord waarop prijzen van bier leesbaar kunnen zijn?
Niet: eten, interieur, mensen, glazen zonder kaart, een QR-code zonder prijzen.
Antwoord alleen met JSON: {"menu": [nummers]}`;

const LEES = `Dit is een foto van een kaart in een Nederlands café. Lees alle bieren met hun prijs.
Antwoord alleen met JSON:
{"leesbaar": true/false,
 "datum_op_kaart": "tekst of null",
 "kop": [links, boven, rechts, onder] of null,
 "bieren": [{"merk": "Hertog Jan", "omschrijving": "zoals op de kaart", "cl": 25 of null, "prijs": 3.9, "tap": true/false/null, "pils": true/false, "actie": true/false, "vak": [links, boven, rechts, onder]}]}
Regels: "cl" alleen als de maat er staat (0,25l = 25; 0,5 = 50). Staan er twee prijzen voor twee maten ("0,25/0,5 4/8"), maak dan twee regels. "tap" is true bij "van de tap", "fust" of "tap"; false bij "fles". "actie" is true bij een tijdelijke of bijzondere prijs, zoals happy hour, een dagaanbieding ("dinsdag", "vanaf 20.00 uur"), een studentenprijs of een weekkalender. "vak" is waar de regel met deze prijs op de foto staat, en "kop" de kop boven de bierlijst (zoals "Bier van de tap"), beide als fractie van de breedte en hoogte van de foto (0 tot 1). Verzin niets: wat je niet kunt lezen, laat je weg.`;

/** Opgeteld verbruik van deze run (verzoeken en tokens). */
export const verbruik = { verzoeken: 0, in: 0, uit: 0 };

/** Haalt redeneertekst van modellen die nadenken weg: <think>...</think>, ook als de openingstag ontbreekt. */
export function zonderDenken(tekst) {
  let t = String(tekst ?? "");
  const eind = t.lastIndexOf("</think>");
  if (eind >= 0) t = t.slice(eind + "</think>".length);
  return t.replace(/<think>[\s\S]*$/, "");
}

/** Het eerste geldige JSON-object in een antwoord, of null. */
export function haalJson(tekst) {
  if (!tekst) return null;
  const t = zonderDenken(tekst);
  for (let begin = t.indexOf("{"); begin >= 0; begin = t.indexOf("{", begin + 1)) {
    const eind = sluitHaak(t, begin);
    if (eind < 0) continue;
    try {
      return JSON.parse(t.slice(begin, eind + 1));
    } catch {
      // geen geldige JSON op deze plek; probeer de volgende {
    }
  }
  return null;
}

// Positie van de } die bij de { op plek begin hoort, met aandacht voor tekst tussen aanhalingstekens.
function sluitHaak(t, begin) {
  let diepte = 0;
  let inTekst = false;
  for (let i = begin; i < t.length; i++) {
    const c = t[i];
    if (inTekst) {
      if (c === "\\") i += 1;
      else if (c === '"') inTekst = false;
    } else if (c === '"') inTekst = true;
    else if (c === "{") diepte += 1;
    else if (c === "}" && --diepte === 0) return i;
  }
  return -1;
}

// denken: false zet het nadenken van het model uit. Voor ja/nee-vragen (herkennen,
// controleren) scheelt dat honderden tot duizenden tokens per verzoek; voor het lezen
// van prijzen laten we het (laag) aan, want zonder nadenken leest het model slordig.
// antwoorden: optionele lijst waarin elk gelezen antwoord (of null) komt; het meetscript
// van de testset ziet zo het verschil tussen "nee" en "geen bruikbaar antwoord".
async function vraag(afbeeldingen, tekst, { model = STANDAARD_MODEL, maxTokens = 8000, denken = true, log = () => {}, antwoorden = null } = {}) {
  const content = [
    ...afbeeldingen.map((b) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b.toString("base64")}` } })),
    { type: "text", text: tekst },
  ];
  const res = await fetch(`${model.url.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${model.sleutel}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model.model,
      max_tokens: model.lokaal ? Math.max(maxTokens, LOKAAL_MIN_TOKENS) : maxTokens,
      // Lokaal: geen instelling voor nadenken (dat doet het model zelf), wel een vast antwoord (temperatuur 0)
      ...(model.lokaal ? { temperature: 0 } : denken ? { reasoning_effort: "low" } : { thinking: { type: "disabled" } }),
      messages: [{ role: "user", content }],
    }),
    // Een lokaal model op een gewone videokaart kan per foto een halve minuut of meer nodig hebben
    signal: AbortSignal.timeout(model.lokaal ? LOKAAL_TIMEOUT_MS : 180000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Model gaf HTTP ${res.status}: ${body.slice(0, 300)}`);
  const d = JSON.parse(body);
  log(`    model: ${d.usage?.prompt_tokens ?? "?"} tokens in, ${d.usage?.completion_tokens ?? "?"} uit`);
  verbruik.verzoeken += 1;
  verbruik.in += d.usage?.prompt_tokens || 0;
  verbruik.uit += d.usage?.completion_tokens || 0;
  if (d.choices?.[0]?.finish_reason === "length") log("    let op: antwoord afgekapt (maximum aantal tokens bereikt)");
  const json = haalJson(d.choices?.[0]?.message?.content);
  antwoorden?.push(json);
  return json;
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
  if (!antwoord || antwoord.leesbaar === false) return { bieren: [], datumOpKaart: null, kop: null };
  return { bieren: Array.isArray(antwoord.bieren) ? antwoord.bieren : [], datumOpKaart: antwoord.datum_op_kaart || null, kop: antwoord.kop || null };
}

const LOS = `Is op deze foto van een café een drankkaart, menukaart, prijslijst of krijtbord met prijzen te zien, ook als die klein in beeld is?
Niet: alleen eten, glazen, flessen, mensen of een QR-code. Antwoord alleen met JSON: {"kaart": true/false}`;

/** Schiften per foto in plaats van op een contactblad. Lokaal kost een foto niets, en kleine modellen
 * lezen de nummers op een contactblad niet goed. Geeft de indexen van de foto's met een kaart. */
export async function herkenLos(miniaturen, opties) {
  const treffers = [];
  for (const [i, m] of miniaturen.entries()) {
    const antwoord = await vraag([m], LOS, { ...opties, denken: false, maxTokens: 50 });
    if (antwoord?.kaart === true) treffers.push(i);
  }
  return treffers;
}

const BEVESTIG = (v) => `Dit is een kaart van een Nederlands café. Staat hierop pils van de tap (zoals ${v.merk}) in 25 cl (een vaasje) voor € ${(v.prijs_cent / 100).toFixed(2).replace(".", ",")}?
Kijk alleen naar wat er staat. Antwoord alleen met JSON: {"klopt": true/false, "prijs_op_kaart": getal of null}`;

/** Tweede mening van een ander model over de gekozen vaasjesprijs. Zonder duidelijk "ja" geen prijs. */
export async function bevestigVaasje(foto, vaasje, opties) {
  const antwoord = await vraag([foto], BEVESTIG(vaasje), { ...opties, denken: false, maxTokens: 100 });
  const gezien = Number(antwoord?.prijs_op_kaart);
  const zelfdePrijs = !Number.isFinite(gezien) || gezien <= 0 || Math.round(gezien * 100) === vaasje.prijs_cent;
  return { klopt: antwoord?.klopt === true && zelfdePrijs, prijsOpKaart: Number.isFinite(gezien) && gezien > 0 ? gezien : null };
}
