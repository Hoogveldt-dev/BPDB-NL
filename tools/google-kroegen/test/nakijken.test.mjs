import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kiesSteekproef, maakUitsnede, naarPixels, nieuweMap, schrijfGevallen, verwerkOordelen } from "../bron/nakijken.mjs";
import { kanBeelden, leesJpeg, schrijfJpeg } from "../bron/beeld.mjs";
import { kiesVaasje } from "../bron/vaasje.mjs";

test("vak: fracties, pixels en promille naar pixels", () => {
  assert.deepEqual(naarPixels([0.1, 0.5, 0.9, 0.55], 1600, 1200), { x1: 160, y1: 600, x2: 1440, y2: 660 });
  assert.deepEqual(naarPixels([100, 600, 1500, 660], 1600, 1200), { x1: 100, y1: 600, x2: 1500, y2: 660 });
  assert.deepEqual(naarPixels([100, 500, 900, 999], 800, 600), { x1: 80, y1: 300, x2: 720, y2: 599 }, "groter dan de foto: promille");
  assert.deepEqual(naarPixels([0.9, 0.55, 0.1, 0.5], 1600, 1200), { x1: 160, y1: 600, x2: 1440, y2: 660 }, "omgekeerd");
  assert.equal(naarPixels([0.1, 0.5, 0.1, 0.5], 1600, 1200), null);
  assert.equal(naarPixels(null, 1600, 1200), null);
  assert.equal(naarPixels([1, 2, 3], 1600, 1200), null);
  assert.equal(naarPixels([5000, 1, 6000, 2], 1600, 1200), null);
});

test("vaasje: het vak van de gekozen regel reist mee", () => {
  const v = kiesVaasje([{ merk: "Hertog Jan", cl: 25, prijs: 3.9, tap: true, pils: true, vak: [0.1, 0.4, 0.9, 0.45] }]);
  assert.deepEqual(v.vak, [0.1, 0.4, 0.9, 0.45]);
});

test("uitsnede: strook rond de prijsregel, met de kop erboven", { skip: !kanBeelden() && "jpeg-js niet geinstalleerd" }, () => {
  const breedte = 200;
  const hoogte = 400;
  const data = new Uint8Array(breedte * hoogte * 4);
  for (let y = 0; y < hoogte; y++) for (let x = 0; x < breedte; x++) data.set([y % 256, 0, 0, 255], (y * breedte + x) * 4);
  const foto = schrijfJpeg({ breedte, hoogte, data }, 95);
  const alleen = leesJpeg(maakUitsnede(foto, { vak: [0.2, 0.5, 0.8, 0.525] }));
  assert.equal(alleen.breedte, 200, "hele breedte");
  assert.ok(alleen.hoogte >= 40 && alleen.hoogte <= 60, `marge rond de regel (${alleen.hoogte})`);
  const metKop = leesJpeg(maakUitsnede(foto, { vak: [0.2, 0.5, 0.8, 0.525], kop: [0.1, 0.05, 0.9, 0.1] }));
  assert.ok(metKop.hoogte > alleen.hoogte + 20, "kop erboven");
  assert.equal(maakUitsnede(foto, { vak: null }), null);
  assert.equal(maakUitsnede(Buffer.from("geen jpeg"), { vak: [0.1, 0.1, 0.2, 0.2] }), null);
});

test("steekproef: ongeveer de gevraagde fractie, minstens een", () => {
  const lijst = Array.from({ length: 100 }, (_, i) => i);
  let n = 0;
  const vast = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
  const s = kiesSteekproef(lijst, 0.1, vast);
  assert.ok(s.length >= 4 && s.length <= 20, `${s.length}`);
  assert.equal(kiesSteekproef([1, 2], 0.1, () => 0.99).length, 1);
  assert.deepEqual(kiesSteekproef(lijst, 0), []);
  assert.deepEqual(kiesSteekproef([], 0.1), []);
});

const rij = (id, prijs_cent) => ({ google_place_id: id, merk: "Heineken", volume_cl: 25, prijs_cent, datum: "2025-01-01", bron_omschrijving: "Foto" });
const uitkomst = (id, prijs_cent, tweede = { klopt: true, prijsOpKaart: prijs_cent / 100 }) => ({
  merk: "Heineken", volume_cl: 25, prijs_cent, zekerheid: "hoog", datum: "2025-01-01", foto: { id: `foto-${id}`, url: `https://x/${id}` }, vak: [0.1, 0.4, 0.9, 0.45], kop: null, tweede,
});

test("nakijken: gevallen wegschrijven en oordelen verwerken", async () => {
  const basis = await mkdtemp(join(tmpdir(), "nakijken-"));
  const map = nieuweMap(basis, "2026-11-10");
  assert.equal(map, join(basis, "2026-11-10"));
  const rijen = [rij("a", 380), rij("b", 390)];
  const modellen = { lezer: "qwen/qwen3.5-9b", kijker: "google/gemma-4-e4b" };
  const gevallen = [
    { soort: "twijfel", kroeg: "Café Een", place_id: "t1", uitkomst: uitkomst("t1", 360, { klopt: false, prijsOpKaart: 3.9 }), rij: rij("t1", 360), reden: "tweede mening oneens", modellen },
    { soort: "twijfel", kroeg: "Café Twee", place_id: "t2", uitkomst: uitkomst("t2", 850), rij: rij("t2", 850), reden: "prijs buiten bereik", modellen },
    { soort: "steekproef", kroeg: "Café A", place_id: "a", uitkomst: uitkomst("a", 380), rij: rij("a", 380), reden: "steekproef", modellen },
    { soort: "steekproef", kroeg: "Café B", place_id: "b", uitkomst: uitkomst("b", 390), rij: rij("b", 390), reden: "steekproef", modellen },
  ];
  await schrijfGevallen(map, gevallen, { haalBeeld: async (url) => Buffer.from(url), rijen });
  assert.equal(nieuweMap(basis, "2026-11-10"), join(basis, "2026-11-10-2"));
  const geval = JSON.parse(await readFile(join(map, "001-twijfel-Caf_Een", "geval.json"), "utf8"));
  assert.deepEqual(geval.gelezen, { merk: "Heineken", volume_cl: 25, prijs: 3.6, datum: "2025-01-01" });
  assert.deepEqual(geval.kijker, { model: "google/gemma-4-e4b", klopt: false, prijs_op_kaart: 3.9 });
  assert.equal(geval.reden, "tweede mening oneens");
  assert.equal(geval.uitsnede, null, "geen JPEG, dus geen uitsnede");
  assert.ok(existsSync(join(map, "001-twijfel-Caf_Een", "foto.jpg")));

  const oordeel = (o) => JSON.stringify({ juiste_prijs: null, toelichting: "", ...o });
  await writeFile(join(map, "001-twijfel-Caf_Een", "oordeel.json"), oordeel({ is_menukaart: true, prijs_klopt: true }));
  await writeFile(join(map, "002-twijfel-Caf_Twee", "oordeel.json"), `Hier is mijn oordeel: ${oordeel({ is_menukaart: true, prijs_klopt: false, juiste_prijs: 4.5, toelichting: "50 cl" })}`);
  await writeFile(join(map, "003-steekproef-Caf_A", "oordeel.json"), oordeel({ is_menukaart: true, prijs_klopt: false, toelichting: "fluitje" }));
  // 004 zonder oordeel

  const { prijzen, rapport } = await verwerkOordelen(map);
  assert.deepEqual(prijzen.map((p) => p.google_place_id), ["b", "t1"]);
  assert.equal(rapport.twijfels, 2);
  assert.equal(rapport.twijfels_goedgekeurd, 1);
  assert.equal(rapport.steekproef, 2);
  assert.equal(rapport.steekproef_afgekeurd, 1);
  assert.equal(rapport.niet_nagekeken, 1);
  assert.equal(rapport.samen_fout, "1 van 1 (100%)");
  assert.deepEqual(rapport.afgekeurd.map((a) => [a.kroeg, a.juiste_prijs]), [["Café Twee", 4.5], ["Café A", null]]);
});

test("leesKaart: kop en vakken komen mee uit het antwoord", async () => {
  const { leesKaart } = await import("../bron/menulezer.mjs");
  const echt = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"leesbaar": true, "kop": [0.1, 0.1, 0.9, 0.15], "bieren": [{"merk": "Brand", "cl": 25, "prijs": 3.6, "vak": [0.1, 0.3, 0.9, 0.35]}]}' } }] }), { status: 200 });
  try {
    const r = await leesKaart(Buffer.from("x"), {});
    assert.deepEqual(r.kop, [0.1, 0.1, 0.9, 0.15]);
    assert.deepEqual(r.bieren[0].vak, [0.1, 0.3, 0.9, 0.35]);
  } finally {
    globalThis.fetch = echt;
  }
});
