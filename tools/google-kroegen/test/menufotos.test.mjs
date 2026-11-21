import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fotolijstVerzoek, ontleedFotolijst, FotolijstOnleesbaar, miniatuur, origineel } from "../bron/fotos.mjs";
import { exifDatum } from "../bron/exif.mjs";
import { kiesVaasje } from "../bron/vaasje.mjs";
import { haalJson } from "../bron/menulezer.mjs";
import { zoekMenuprijs, naarMenuImport } from "../bron/menuprijs.mjs";

// Nagebouwd antwoord van hspqX, met alleen de indexen die de tool leest.
function nepFoto(id, soort, upload, door = 2) {
  const x = new Array(22).fill(null);
  x[0] = id;
  x[1] = 10;
  x[2] = soort;
  x[6] = [`https://lh3.googleusercontent.com/gps-cs-s/${id}=w203-h135-k-no`, "", [4000, 3000], [203, 100]];
  x[21] = [null, [10, id], null, null, null, null, [door, null, null, [1, 9], null, [null, null, "photos:gmm_android"], null, null, upload]];
  return x;
}
export function nepFotolijst(fotos, totaal, token) {
  const binnen = [fotos, totaal, null, "sessie", null, token];
  return `)]}'\n\n123\n${JSON.stringify([["wrb.fr", "hspqX", JSON.stringify(binnen), null, null, null, "generic"]])}\n`;
}

test("fotolijst: foto's, soort, URL zonder grootte, uploaddatum, token", () => {
  const t = nepFotolijst([nepFoto("A", 12, [2024, 12, 15, 19]), nepFoto("B", 10, [2021, 7, 1, 22], 1)], 360, "TOKEN2");
  const r = ontleedFotolijst(t);
  assert.equal(r.totaal, 360);
  assert.equal(r.token, "TOKEN2");
  assert.deepEqual(r.fotos[0], {
    id: "A", soort: "foto", url: "https://lh3.googleusercontent.com/gps-cs-s/A",
    breedte: 4000, hoogte: 3000, door: "bezoeker", bron: "photos:gmm_android", geupload: "2024-12-15",
  });
  assert.equal(r.fotos[1].soort, "video");
  assert.equal(r.fotos[1].door, "eigenaar");
});

test("fotolijst: ander antwoord geeft een duidelijke fout", () => {
  assert.throws(() => ontleedFotolijst("<html>sorry</html>"), FotolijstOnleesbaar);
});

test("fotolijst: verzoek bevat data-ID en token", () => {
  const body = decodeURIComponent(fotolijstVerzoek("0x1:0x2", "TOK").slice(6));
  const args = JSON.parse(JSON.parse(body.slice(0, -1))[0][0][1]);
  assert.equal(args[2][0], "0x1:0x2");
  assert.equal(args[4][2][2], "TOK");
});

test("foto-URL's: miniatuur en origineel", () => {
  assert.equal(miniatuur("https://x/y"), "https://x/y=w256-h256-k-no");
  assert.equal(origineel("https://x/y"), "https://x/y=s0");
});

test("EXIF: DateTimeOriginal gaat voor DateTime", () => {
  assert.equal(exifDatum(readFileSync(new URL("./exif-klein.jpg", import.meta.url))), "2024-06-04");
});

test("EXIF: zonder gegevens of geen JPEG geeft null", () => {
  assert.equal(exifDatum(readFileSync(new URL("./zonder-exif.jpg", import.meta.url))), null);
  assert.equal(exifDatum(Buffer.from("geen jpeg")), null);
});

test("vaasje: goedkoopste pils van de tap in 25 cl", () => {
  const v = kiesVaasje([
    { merk: "Hertog Jan", cl: 25, prijs: 4, tap: true, pils: true },
    { merk: "Hertog Jan", cl: 50, prijs: 8, tap: true, pils: true },
    { merk: "Jupiler", cl: 25, prijs: 3.9, tap: true, pils: true },
    { merk: "Leffe", cl: 25, prijs: 5.9, tap: true, pils: false },
    { merk: "Hertog Jan 0.0", cl: 30, prijs: 3.5, tap: false, pils: false },
  ]);
  assert.deepEqual(v, { merk: "Jupiler", volume_cl: 25, prijs_cent: 390, zekerheid: "hoog" });
});

test("vaasje: geen maat alleen bij het woord vaasje of vaas; anders liever niets", () => {
  assert.equal(kiesVaasje([{ merk: "Hertog Jan", omschrijving: "medium", cl: null, prijs: 3.9, tap: true }]), null);
  assert.equal(kiesVaasje([{ merk: "Grolsch", omschrijving: "vaasje", cl: null, prijs: 3.6 }]).zekerheid, "middel");
  const vaas = kiesVaasje([{ merk: "Grolsch vaas", cl: null, prijs: 3.5, tap: true }, { merk: "Grolsch fluit", cl: null, prijs: 3.3, tap: true }]);
  assert.equal(vaas.prijs_cent, 350);
  assert.equal(vaas.merk, "Grolsch");
  assert.equal(kiesVaasje([{ merk: "Grolsch fluit", cl: null, prijs: 3.3, tap: true }]), null);
  assert.equal(kiesVaasje([{ merk: "Heineken", cl: 25, prijs: 0.5, tap: true }]), null);
  assert.equal(kiesVaasje([{ merk: "Heineken", cl: 25, prijs: 3.5, tap: false }]), null);
  assert.equal(kiesVaasje([{ merk: "Brand weizen", cl: 25, prijs: 4.5, tap: true }]), null);
});

test("modelantwoord: JSON uit tekst met codeblok", () => {
  assert.deepEqual(haalJson('Hier:\n```json\n{"menu":[2,5]}\n```'), { menu: [2, 5] });
  assert.equal(haalJson("geen json"), null);
});

test("modelantwoord: redeneertekst eraf en het eerste geldige JSON-blok", () => {
  assert.deepEqual(haalJson('<think>Ik zie {"kaart": true/false}...</think>\n{"kaart": true}'), { kaart: true });
  assert.deepEqual(haalJson('Nadenken zonder openingstag {"kaart": false}</think>{"kaart": true}'), { kaart: true });
  assert.deepEqual(haalJson('Het format is {kaart: ja}. Antwoord: {"bieren": [{"merk": "Brand {tap}", "prijs": 3.6}]} klaar'), { bieren: [{ merk: "Brand {tap}", prijs: 3.6 }] });
  assert.equal(haalJson('<think>afgekapt midden in het nadenken {"kaart": true}'), null);
});

// De rollen in een apart proces, zodat eigen LOKAAL_*-variabelen de test niet beinvloeden.
async function rollenMet(env) {
  const { execFileSync } = await import("node:child_process");
  const schoon = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("LOKAAL_")));
  const code = 'const { LOKAAL } = await import("./bron/menulezer.mjs"); console.log(JSON.stringify(LOKAAL))';
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code], { cwd: new URL("..", import.meta.url), env: { ...schoon, ...env } }).toString());
}

test("lokale modellen: drie rollen met standaarden voor LM Studio", async () => {
  const l = await rollenMet({});
  assert.equal(l.schifter.url, "http://localhost:1235/v1");
  assert.deepEqual([l.schifter.model, l.lezer.model, l.kijker.model], ["google/gemma-4-e4b", "qwen/qwen3.5-9b", "google/gemma-4-e4b"]);
});

test("lokale modellen: oude variabele LOKAAL_KIJKER geldt ook voor de schifter; Ollama via LOKAAL_URL", async () => {
  const l = await rollenMet({ LOKAAL_KIJKER: "qwen2.5-vl-7b-instruct", LOKAAL_URL: "http://localhost:11434/v1" });
  assert.deepEqual([l.schifter.model, l.kijker.model, l.lezer.url], ["qwen2.5-vl-7b-instruct", "qwen2.5-vl-7b-instruct", "http://localhost:11434/v1"]);
  assert.equal((await rollenMet({ LOKAAL_KIJKER: "a", LOKAAL_SCHIFTER: "b" })).schifter.model, "b");
});

test("lokale modellen: controle bij de start noemt ontbrekende en beschikbare modellen", async () => {
  const { STANDAARD_MODEL, controleerModellen } = await import("../bron/menulezer.mjs");
  const lok = (model) => ({ url: "http://localhost:1235/v1", model, sleutel: "lokaal", lokaal: true });
  const LOKAAL = { schifter: lok("google/gemma-4-e4b"), lezer: lok("qwen/qwen3.5-9b"), kijker: lok("google/gemma-4-e4b") };
  const echt = globalThis.fetch;
  const gevraagd = [];
  globalThis.fetch = async (url) => {
    gevraagd.push(url);
    return new Response(JSON.stringify({ data: [{ id: "qwen/qwen3.5-9b" }, { id: "google/gemma-4-e4b" }, { id: "qwen2.5-vl-7b-instruct" }] }), { status: 200 });
  };
  try {
    await controleerModellen([LOKAAL.schifter, LOKAAL.lezer, LOKAAL.kijker, STANDAARD_MODEL]);
    assert.deepEqual(gevraagd, ["http://localhost:1235/v1/models"], "een keer per server, niet voor DeepSeek");
    await assert.rejects(controleerModellen([{ ...LOKAAL.kijker, model: "llama3.2-vision:11b" }]),
      /Model llama3\.2-vision:11b staat niet op .*Beschikbaar: qwen\/qwen3\.5-9b, google\/gemma-4-e4b, qwen2\.5-vl-7b-instruct/);
    globalThis.fetch = async () => { throw new Error("fetch failed"); };
    await assert.rejects(controleerModellen([LOKAAL.lezer]), /Geen lokale modelserver op http:\/\/localhost:1235\/v1.*LM Studio/);
  } finally {
    globalThis.fetch = echt;
  }
});

test("zoekMenuprijs: kaart herkennen, EXIF-datum, nieuwste kaart wint", async () => {
  const exif = readFileSync(new URL("./exif-klein.jpg", import.meta.url));
  const zonder = readFileSync(new URL("./zonder-exif.jpg", import.meta.url));
  const fotos = ontleedFotolijst(nepFotolijst([
    nepFoto("eten", 12, [2025, 9, 1, 1]),
    nepFoto("kaartOud", 12, [2023, 3, 1, 1]),
    nepFoto("kaartNieuw", 12, [2024, 10, 3, 21]),
    nepFoto("film", 10, [2025, 1, 1, 1]),
  ], 4, null)).fotos;
  const gevraagd = [];
  const r = await zoekMenuprijs(fotos, {
    ontdubbel: false, // alle miniaturen zijn hier dezelfde afbeelding
    haalBeeld: async (url) => {
      gevraagd.push(url);
      return url.includes("kaartNieuw") && url.endsWith("=s0") ? exif : zonder;
    },
    herken: async (miniaturen) => {
      assert.equal(miniaturen.length, 3); // geen video
      return [1, 2]; // volgorde: eten (2025), kaartNieuw (2024), kaartOud (2023)
    },
    controleer: async () => true,
    lees: async (beeld, _o) => ({ bieren: [{ merk: "Jupiler", cl: 25, prijs: beeld === zonder ? 4 : 4, tap: true, pils: true }], datumOpKaart: null }),
  });
  assert.equal(r.bekeken, 3);
  assert.equal(r.kaarten, 2);
  assert.equal(r.prijs.datum, "2024-06-04"); // opname uit EXIF, niet de upload
  assert.equal(r.prijs.datumBron, "opname");
  assert.equal(r.prijs.foto.id, "kaartNieuw");
  assert.ok(gevraagd.some((u) => u.endsWith("kaartOud=s0")));
  assert.deepEqual(naarMenuImport("PID", r.prijs), {
    google_place_id: "PID", merk: "Jupiler", volume_cl: 25, prijs_cent: 400, datum: "2024-06-04",
    bron_omschrijving: "Kaartfoto Google Maps, genomen 2024-06-04",
  });
});

test("zoekMenuprijs: alleen foto's vanaf --sinds", async () => {
  const fotos = ontleedFotolijst(nepFotolijst([nepFoto("oud", 12, [2019, 1, 1, 1])], 1, null)).fotos;
  const r = await zoekMenuprijs(fotos, { haalBeeld: async () => Buffer.alloc(0), herken: async () => [], controleer: async () => true, lees: async () => ({ bieren: [] }), sinds: "2024-01-01" });
  assert.equal(r.bekeken, 0);
  assert.equal(r.prijs, null);
});

test("zoekMenuprijs: nieuwste eerst en stoppen na de eerste groep met een prijs", async () => {
  const lijst = [];
  for (let i = 0; i < 30; i++) lijst.push(nepFoto(`f${i}`, 12, [2020 + Math.floor(i / 10), 1 + (i % 10), 1, 1]));
  const fotos = ontleedFotolijst(nepFotolijst(lijst, 30, null)).fotos;
  const groepen = [];
  const r = await zoekMenuprijs(fotos, {
    groep: 10,
    haalBeeld: async () => Buffer.alloc(0),
    herken: async (miniaturen) => {
      groepen.push(miniaturen.length);
      return [3];
    },
    controleer: async () => true,
    lees: async () => ({ bieren: [{ merk: "Heineken", cl: 25, prijs: 3.6, tap: true, pils: true }] }),
  });
  assert.deepEqual(groepen, [10]); // tweede en derde groep niet meer naar het model
  assert.equal(r.bekeken, 10);
  assert.equal(r.prijs.foto.geupload, "2022-07-01"); // vierde-nieuwste foto
});

test("zoekMenuprijs: volledig bekijkt alle groepen", async () => {
  const lijst = [];
  for (let i = 0; i < 25; i++) lijst.push(nepFoto(`g${i}`, 12, [2024, 1, 1 + i, 1]));
  const fotos = ontleedFotolijst(nepFotolijst(lijst, 25, null)).fotos;
  let aanroepen = 0;
  await zoekMenuprijs(fotos, {
    groep: 10, volledig: true, maxKandidaten: 10,
    haalBeeld: async () => Buffer.alloc(0),
    herken: async () => { aanroepen += 1; return [0]; },
    controleer: async () => true,
    lees: async () => ({ bieren: [{ merk: "Heineken", cl: 25, prijs: 3.6, tap: true, pils: true }] }),
  });
  assert.equal(aanroepen, 3);
});

test("contactblad: genummerde cellen in een raster", async () => {
  const { bladHtml } = await import("../bron/contactblad.mjs");
  const html = bladHtml([Buffer.from("a"), Buffer.from("b"), Buffer.from("c")], { kolommen: 2, px: 100 });
  assert.equal((html.match(/<img /g) || []).length, 3);
  assert.match(html, /<b>3<\/b>/);
  assert.match(html, /repeat\(2,100px\)/);
});

test("zoekMenuprijs: wat de controle afkeurt, wordt niet gelezen", async () => {
  const fotos = ontleedFotolijst(nepFotolijst([nepFoto("qr", 12, [2025, 1, 1, 1]), nepFoto("kaart", 12, [2024, 1, 1, 1])], 2, null)).fotos;
  const gelezen = [];
  const r = await zoekMenuprijs(fotos, {
    haalBeeld: async (url) => Buffer.from(url),
    herken: async () => [0, 1],
    controleer: async (beeld) => !beeld.toString().includes("/qr="),
    lees: async (beeld) => {
      gelezen.push(beeld.toString());
      return { bieren: [{ merk: "Heineken", cl: 25, prijs: 3.6, tap: true, pils: true }] };
    },
  });
  assert.equal(r.gecontroleerd, 2);
  assert.equal(r.gelezen, 1);
  assert.ok(gelezen.every((u) => u.includes("/kaart=")));
  assert.equal(r.prijs.foto.id, "kaart");
});

test("zoekMenuprijs: zonder ja van de tweede mening gaat de prijs naar twijfels", async () => {
  const zonder = readFileSync(new URL("./zonder-exif.jpg", import.meta.url));
  const fotos = ontleedFotolijst(nepFotolijst([nepFoto("kaart", 12, [2025, 3, 1, 1])], 1, null)).fotos;
  const lees = async () => ({ bieren: [{ merk: "Heineken", cl: 25, prijs: 3.6, tap: true, pils: true }], datumOpKaart: null });
  const nee = await zoekMenuprijs(fotos, {
    haalBeeld: async () => zonder, herken: async () => [0], controleer: async () => true, lees,
    bevestig: async () => ({ klopt: false, prijsOpKaart: 3.9 }),
  });
  assert.equal(nee.prijs, null);
  assert.equal(nee.twijfels.length, 1);
  assert.equal(nee.twijfels[0].prijs_cent, 360);
  assert.equal(nee.twijfels[0].tweedePrijs, 3.9);
  const ja = await zoekMenuprijs(fotos, {
    haalBeeld: async () => zonder, herken: async () => [0], controleer: async () => true, lees,
    bevestig: async () => ({ klopt: true, prijsOpKaart: 3.6 }),
  });
  assert.equal(ja.prijs.prijs_cent, 360);
  assert.equal(ja.twijfels.length, 0);
});

test("lokale modellen: geen sleutel, geen instelling voor nadenken, temperatuur 0, en een tweede mening die op de prijs let", async () => {
  const { LOKAAL, bevestigVaasje, herkenLos } = await import("../bron/menulezer.mjs");
  const verzoeken = [];
  const echt = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    verzoeken.push({ url, body });
    const vraag = body.messages[0].content.at(-1).text;
    const antwoord = vraag.includes('"kaart"') ? { kaart: verzoeken.length === 1 } : { klopt: true, prijs_op_kaart: 3.9 };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(antwoord) } }] }), { status: 200 });
  };
  try {
    const beeld = Buffer.from("x");
    assert.deepEqual(await herkenLos([beeld, beeld], { model: LOKAAL.schifter }), [0]);
    assert.equal(verzoeken.length, 2, "elke foto apart");
    assert.equal(verzoeken[0].url, `${LOKAAL.schifter.url}/chat/completions`);
    assert.equal(verzoeken[0].body.model, LOKAAL.schifter.model);
    assert.ok(verzoeken[0].body.max_tokens >= 8192, "ruimte om na te denken");
    assert.equal(verzoeken[0].body.temperature, 0);
    assert.equal(verzoeken[0].body.thinking, undefined);
    assert.equal(verzoeken[0].body.reasoning_effort, undefined);
    // Het tweede model ziet een andere prijs dan gekozen: geen bevestiging
    const r = await bevestigVaasje(beeld, { merk: "Heineken", prijs_cent: 360 }, { model: LOKAAL.kijker });
    assert.deepEqual(r, { klopt: false, prijsOpKaart: 3.9 });
  } finally {
    globalThis.fetch = echt;
  }
});
