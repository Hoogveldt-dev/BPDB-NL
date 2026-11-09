import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afwijkingVanMediaan, kiesDatum, mediaan, prijsBuitenBereik, scheidUitschieters } from "../bron/controles.mjs";
import { vindBedragen } from "../bron/ocr.mjs";
import { dHash, hamming, kanBeelden } from "../bron/beeld.mjs";
import { naarMenuImport, zoekMenuprijs } from "../bron/menuprijs.mjs";

const foto = (id, geupload) => ({ id, soort: "foto", url: `https://x/${id}`, geupload });
const heineken = async () => ({ bieren: [{ merk: "Heineken", cl: 25, prijs: 3.6, tap: true, pils: true }], datumOpKaart: null });

test("controles: prijs tussen 2,00 en 7,50", () => {
  assert.equal(prijsBuitenBereik(200), null);
  assert.equal(prijsBuitenBereik(750), null);
  assert.match(prijsBuitenBereik(199), /buiten € 2,00 tot € 7,50/);
  assert.match(prijsBuitenBereik(790), /€ 7\.90/);
});

test("controles: mediaan en meer dan 30% afwijking", () => {
  assert.equal(mediaan([400, 350, 380]), 380);
  assert.equal(mediaan([350, 400]), 375);
  assert.equal(mediaan([]), null);
  assert.equal(afwijkingVanMediaan(390, 380), null);
  assert.equal(afwijkingVanMediaan(494, 380), null); // precies 30%
  assert.match(afwijkingVanMediaan(500, 380), /32% af van de mediaan/);
  assert.equal(afwijkingVanMediaan(900, null), null);
});

test("controles: uitschieters naar twijfels, mediaan uit eigen uitvoer of database", () => {
  const rij = (id, prijs_cent) => ({ google_place_id: id, prijs_cent });
  const eigen = scheidUitschieters([rij("a", 380), rij("b", 390), rij("c", 400), rij("d", 370), rij("e", 600)], 999);
  assert.equal(eigen.mediaanBron, "eigen uitvoer");
  assert.deepEqual(eigen.twijfels.map((t) => t.google_place_id), ["e"]);
  assert.equal(eigen.goed.length, 4);
  const db = scheidUitschieters([rij("a", 380), rij("b", 260)], 390);
  assert.equal(db.mediaanBron, "database");
  assert.deepEqual(db.twijfels.map((t) => t.google_place_id), ["b"]);
  const geen = scheidUitschieters([rij("a", 900)], null);
  assert.equal(geen.mediaan, null);
  assert.equal(geen.goed.length, 1);
});

test("controles: datum uit EXIF, met verkeerde klok en oude foto's", () => {
  const vandaag = "2026-11-09";
  assert.deepEqual(kiesDatum({ opname: "2025-12-20", geupload: "2026-01-03", vandaag }), { datum: "2025-12-20", datumBron: "opname", klokFout: false, oud: false, opmerkingen: [] });
  const laterDanUpload = kiesDatum({ opname: "2026-03-01", geupload: "2026-01-03", vandaag });
  assert.equal(laterDanUpload.datum, "2026-01-03");
  assert.equal(laterDanUpload.datumBron, "upload");
  assert.equal(laterDanUpload.klokFout, true);
  assert.match(laterDanUpload.opmerkingen[0], /klok van de camera/);
  const toekomst = kiesDatum({ opname: "2031-01-01", geupload: null, vandaag });
  assert.equal(toekomst.datum, null);
  assert.equal(toekomst.klokFout, true);
  const oud = kiesDatum({ opname: "2013-06-04", geupload: "2024-10-03", vandaag });
  assert.equal(oud.datum, "2013-06-04");
  assert.equal(oud.oud, true);
  assert.match(oud.opmerkingen[0], /ouder dan tien jaar/);
  assert.equal(kiesDatum({ opname: "2016-11-10", geupload: null, vandaag }).oud, false);
  assert.deepEqual(kiesDatum({ opname: null, geupload: "2024-01-01", vandaag }).datumBron, "upload");
});

test("OCR: bedragen in de tekst van een kaart", () => {
  assert.deepEqual(vindBedragen("Hertog Jan 25cl 3,90\nHertog Jan 50cl € 7,50\nLeffe 5.20\nBitterballen 7,-\nWijn 4.-"), [3.9, 7.5, 5.2, 7, 4]);
  assert.deepEqual(vindBedragen("€4 en € 12"), [4, 12]);
  assert.deepEqual(vindBedragen("Welkom bij ons cafe! Open vanaf 2014"), []);
  assert.deepEqual(vindBedragen("0,25 l en 123,45"), []);
  assert.deepEqual(vindBedragen(""), []);
});

test("dHash: dezelfde foto is gelijk, een andere foto niet", { skip: !kanBeelden() && "jpeg-js niet geinstalleerd" }, () => {
  const a = readFileSync(new URL("./exif-klein.jpg", import.meta.url));
  const b = readFileSync(new URL("./zonder-exif.jpg", import.meta.url));
  assert.equal(hamming(dHash(a), dHash(Buffer.from(a))), 0);
  assert.equal(typeof dHash(b), "bigint");
  assert.equal(dHash(Buffer.from("geen jpeg")), null);
});

test("hamming: aantal verschillende bits", () => {
  assert.equal(hamming(0b1011n, 0b0001n), 2);
  assert.equal(hamming(0n, 0n), 0);
});

test("zoekMenuprijs: bijna gelijke foto's binnen een kroeg worden overgeslagen, de nieuwste blijft", async () => {
  const fotos = [foto("oud", "2023-01-01"), foto("nieuw", "2025-01-01"), foto("anders", "2024-01-01")];
  const hashes = { nieuw: 0b1111n, oud: 0b1110n, anders: 0xffff0000n };
  const gezien = [];
  const r = await zoekMenuprijs(fotos, {
    haalBeeld: async (url) => Buffer.from(url),
    hash: (b) => hashes[b.toString().split("/").pop().split("=")[0]],
    herken: async (m) => { gezien.push(...m.map((x) => x.toString().split("/").pop().split("=")[0])); return []; },
    controleer: async () => true, lees: heineken,
  });
  assert.deepEqual(gezien, ["nieuw", "anders"]);
  assert.equal(r.dubbel, 1);
  assert.equal(r.bekeken, 3);
});

test("zoekMenuprijs: OCR filter laat foto's zonder bedrag weg, volgorde bekijkt ze daarna", async () => {
  const fotos = [foto("krijt", "2025-02-01"), foto("kaart", "2025-01-01")];
  const ocr = { bedragen: async (b) => (b.toString().includes("/kaart=") ? [3.6] : []) };
  const naam = (b) => b.toString().split("/").pop().split("=")[0];
  const opties = (ocrModus, gezien, uitkomst) => ({
    ocr, ocrModus, ontdubbel: false,
    haalBeeld: async (url) => Buffer.from(url),
    herken: async (m) => { gezien.push(m.map(naam)); return m.map((_, i) => i); },
    controleer: async () => true,
    lees: async (b) => (uitkomst(naam(b)) ? heineken() : { bieren: [] }),
  });
  const filter = [];
  const f = await zoekMenuprijs(fotos, opties("filter", filter, () => false));
  assert.deepEqual(filter, [["kaart"]]);
  assert.equal(f.zonderBedrag, 1);
  const volgorde = [];
  const v = await zoekMenuprijs(fotos, opties("volgorde", volgorde, (n) => n === "krijt"));
  assert.deepEqual(volgorde, [["kaart"], ["krijt"]], "eerst met bedrag, dan de rest");
  assert.equal(v.prijs.foto.id, "krijt");
  const stop = [];
  await zoekMenuprijs(fotos, opties("volgorde", stop, () => true));
  assert.deepEqual(stop, [["kaart"]], "geen tweede ronde als er al een prijs is");
});

test("zoekMenuprijs: prijs buiten bereik gaat naar twijfels; verkeerde klok en oude foto in de omschrijving", async () => {
  const duur = await zoekMenuprijs([foto("k", "2025-01-01")], {
    haalBeeld: async () => Buffer.alloc(0), herken: async () => [0], controleer: async () => true,
    lees: async () => ({ bieren: [{ merk: "Heineken", cl: 25, prijs: 8.5, tap: true, pils: true }] }),
  });
  assert.equal(duur.prijs, null);
  assert.match(duur.twijfels[0].reden, /buiten € 2,00 tot € 7,50/);
  const p = { merk: "Heineken", volume_cl: 25, prijs_cent: 360, datum: "2013-06-04", datumBron: "upload", klokFout: true, oud: true };
  assert.equal(naarMenuImport("PID", p).bron_omschrijving, "Foto van de kaart in Google Maps, geupload 2013-06-04 (datum van de camera klopte niet, foto ouder dan tien jaar)");
});
