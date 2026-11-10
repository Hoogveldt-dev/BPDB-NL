import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beoordeelDatum, beoordeelJaNee, beoordeelLezen, beoordeelPrijs, telOp } from "../testset/score.mjs";
import { meetFoto, rolModel } from "../testset/meet.mjs";

const exif = readFileSync(new URL("./exif-klein.jpg", import.meta.url));

test("testset: labels zijn geldig en vullen geen prijs in zonder bron", () => {
  const { fotos } = JSON.parse(readFileSync(new URL("../testset/labels.json", import.meta.url), "utf8"));
  const sleutels = new Set();
  for (const l of fotos) {
    assert.ok(!sleutels.has(l.sleutel), `dubbele sleutel ${l.sleutel}`);
    sleutels.add(l.sleutel);
    assert.ok(["google", "bestand"].includes(l.bron), l.sleutel);
    assert.equal(typeof l.kaart, "boolean", l.sleutel);
    assert.equal(typeof l.bierprijzen, "boolean", l.sleutel);
    assert.ok(l.vaasje === null || (l.vaasje >= 1 && l.vaasje <= 10), l.sleutel);
    if (l.vaasje !== null) assert.ok(l.bierprijzen, `${l.sleutel}: prijs zonder bierprijzen`);
    assert.ok(l.datum === null || /^\d{4}-\d{2}-\d{2}$/.test(l.datum), l.sleutel);
    assert.equal(typeof l.gecontroleerd, "boolean", l.sleutel);
  }
});

test("testset: ja/nee-stappen", () => {
  assert.equal(beoordeelJaNee(true, true), "goed");
  assert.equal(beoordeelJaNee(false, false), "goed");
  assert.equal(beoordeelJaNee(true, false), "fout");
  assert.equal(beoordeelJaNee(false, true), "gemist");
  assert.equal(beoordeelJaNee(null, true), "twijfel");
});

test("testset: lezen, kiezen en datum", () => {
  const jan = { bierprijzen: true, vaasje: 3.9, datum: "2025-12-20" };
  assert.equal(beoordeelLezen([{ prijs: 3.5 }, { prijs: 3.9 }], jan), "goed");
  assert.equal(beoordeelLezen([{ prijs: 3.5 }], jan), "fout");
  assert.equal(beoordeelLezen([], jan), "gemist");
  assert.equal(beoordeelLezen(null, jan), "twijfel");
  assert.equal(beoordeelLezen([], { bierprijzen: true, vaasje: null }), "nvt");
  assert.equal(beoordeelPrijs({ prijs_cent: 390, twijfel: false }, jan), "goed");
  assert.equal(beoordeelPrijs({ prijs_cent: 350, twijfel: false }, jan), "fout");
  assert.equal(beoordeelPrijs({ prijs_cent: 390, twijfel: true }, jan), "twijfel");
  assert.equal(beoordeelPrijs({ prijs_cent: null, twijfel: false }, jan), "gemist");
  assert.equal(beoordeelPrijs({ prijs_cent: null, twijfel: false }, { vaasje: null }), "goed");
  assert.equal(beoordeelPrijs({ prijs_cent: 400, twijfel: false }, { vaasje: null }), "fout");
  assert.equal(beoordeelDatum("2025-12-20", jan), "goed");
  assert.equal(beoordeelDatum(null, jan), "gemist");
  assert.equal(beoordeelDatum("2025-12-20", { datum: null }), "nvt");
});

const nepStappen = ({ schift = true, controle = true, bieren = [{ merk: "Hertog Jan", cl: 25, prijs: 3.9, tap: true, pils: true }], klopt = true } = {}) => ({
  schift: async () => schift,
  controleer: async () => controle,
  lees: async () => bieren,
  bevestig: async () => ({ klopt, prijsOpKaart: null }),
});
const rollen = { schifter: rolModel("a", "u"), lezer: rolModel("b", "u"), kijker: rolModel("c", "u") };
const laad = async () => exif;

test("meetFoto: een goede kaart gaat goed door alle stappen", async () => {
  const label = { sleutel: "jan", kaart: true, bierprijzen: true, vaasje: 3.9, datum: "2024-06-04" };
  const r = await meetFoto(label, { rollen, laad, stappen: nepStappen() });
  assert.deepEqual(r.uitslag, { ocr: "nvt", schiften: "goed", controleren: "goed", lezen: "goed", kiezen: "goed", keten: "goed", datum: "goed" });
  assert.equal(r.gekozen.prijs_cent, 390);
  assert.ok(r.ms >= 0 && "lezen" in r.tijden);
});

test("meetFoto: gemiste schifting telt per stap apart, de keten levert dan niets", async () => {
  const label = { sleutel: "jan", kaart: true, bierprijzen: true, vaasje: 3.9, datum: null };
  const r = await meetFoto(label, { rollen, laad, stappen: nepStappen({ schift: false }) });
  assert.equal(r.uitslag.schiften, "gemist");
  assert.equal(r.uitslag.kiezen, "goed");
  assert.equal(r.uitslag.keten, "gemist");
});

test("meetFoto: tweede mening oneens geeft twijfel; QR-bordje wordt niet gelezen", async () => {
  const jan = { sleutel: "jan", kaart: true, bierprijzen: true, vaasje: 3.9, datum: null };
  assert.equal((await meetFoto(jan, { rollen, laad, stappen: nepStappen({ klopt: false }) })).uitslag.keten, "twijfel");
  const qr = { sleutel: "qr", kaart: false, bierprijzen: false, vaasje: null, datum: null };
  const r = await meetFoto(qr, { rollen, laad, stappen: nepStappen({ schift: false, controle: false }) });
  assert.deepEqual(r.uitslag, { ocr: "nvt", schiften: "goed", controleren: "goed", lezen: "nvt", kiezen: "nvt", keten: "goed", datum: "nvt" });
});

test("meetFoto: fout van het model wordt twijfel, ontbrekende foto wordt overgeslagen", async () => {
  const label = { sleutel: "jan", kaart: true, bierprijzen: true, vaasje: 3.9, datum: null };
  const stappen = { ...nepStappen(), controleer: async () => { throw new Error("time-out"); } };
  const r = await meetFoto(label, { rollen, laad, stappen });
  assert.equal(r.uitslag.controleren, "twijfel");
  assert.match(r.fouten[0], /controleren: time-out/);
  const weg = await meetFoto(label, { rollen, laad: async () => null, stappen });
  assert.equal(weg.ontbreekt, true);
  assert.equal(telOp([r, weg]).controleren.twijfel, 1);
});

test("meetFoto: EXIF-datum uit meta.json, zonder origineel", async () => {
  const label = { sleutel: "jan", kaart: true, bierprijzen: true, vaasje: 3.9, datum: "2020-05-01" };
  const zonderS0 = async (_, maat) => (maat === "s0" ? null : Buffer.from("geen jpeg"));
  const r = await meetFoto(label, { rollen, laad: zonderS0, stappen: nepStappen(), meta: { exif: "2020-05-01", geupload: "2021-01-01" } });
  assert.equal(r.uitslag.datum, "goed");
  const zonderExif = await meetFoto(label, { rollen, laad: zonderS0, stappen: nepStappen(), meta: { exif: null, geupload: "2021-01-01" } });
  assert.equal(zonderExif.datum, "2021-01-01");
});

test("meetFoto: lokaal model zonder JSON telt als twijfel", async () => {
  const { STANDAARD_STAPPEN } = await import("../testset/meet.mjs");
  const echt = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "Ik zie een kaart." } }] }), { status: 200 });
  try {
    assert.equal(await STANDAARD_STAPPEN.schift(Buffer.from("x"), rollen.schifter), null);
    assert.equal(await STANDAARD_STAPPEN.lees(Buffer.from("x"), rollen.lezer), null);
  } finally {
    globalThis.fetch = echt;
  }
});

test("meetFoto: OCR die een echte kaart mist, telt als gemist en filtert alleen in de stand filter", async () => {
  const label = { sleutel: "krijt", kaart: true, bierprijzen: true, vaasje: 3.9, datum: null };
  const ocr = { bedragen: async () => [] };
  const volgorde = await meetFoto(label, { rollen, laad, stappen: nepStappen(), ocr, ocrModus: "volgorde" });
  assert.equal(volgorde.uitslag.ocr, "gemist");
  assert.equal(volgorde.uitslag.keten, "goed");
  const filter = await meetFoto(label, { rollen, laad, stappen: nepStappen(), ocr, ocrModus: "filter" });
  assert.equal(filter.uitslag.keten, "gemist");
  const metBedrag = await meetFoto(label, { rollen, laad, stappen: nepStappen(), ocr: { bedragen: async () => [3.9] }, ocrModus: "filter" });
  assert.equal(metBedrag.uitslag.ocr, "goed");
});

test("meetFoto: prijs buiten 2,00 tot 7,50 is twijfel", async () => {
  const label = { sleutel: "duur", kaart: true, bierprijzen: true, vaasje: 8.5, datum: null };
  const r = await meetFoto(label, { rollen, laad, stappen: nepStappen({ bieren: [{ merk: "Heineken", cl: 25, prijs: 8.5, tap: true, pils: true }] }) });
  assert.equal(r.uitslag.kiezen, "twijfel");
});
