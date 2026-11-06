import { test } from "node:test";
import assert from "node:assert/strict";
import { pad } from "../bron/pad.mjs";
import { ontleedZoekantwoord, OnverwachtAntwoord, cidUitDataId, schoneNaam } from "../bron/ontleed.mjs";
import { zaak, antwoord } from "./nep-google.mjs";

test("pad geeft undefined bij ontbrekende stappen", () => {
  assert.equal(pad([1, [2, [3]]], 1, 1, 0), 3);
  assert.equal(pad([1, [2]], 1, 5), undefined);
  assert.equal(pad([1, null], 1, 0), undefined);
  assert.equal(pad("geen lijst", 0), undefined);
});

test("ontleedt alle velden van een zaak", () => {
  const [p] = ontleedZoekantwoord(antwoord([zaak()]));
  assert.equal(p.naam, "Café Test");
  assert.equal(p.naam_google, "Café Test🍺");
  assert.equal(p.place_id, "ChIJtest");
  assert.equal(p.cid, "5104347805243211426");
  assert.deepEqual(p.categorieen, ["Café"]);
  assert.equal(p.adres, "Grote Markt 1");
  assert.equal(p.postcode, "6511 KA");
  assert.equal(p.plaats, "Nijmegen");
  assert.equal(p.lat, 51.8478);
  assert.equal(p.lon, 5.8634);
  assert.equal(p.beoordeling, 4.5);
  assert.equal(p.aantal_reviews, 120);
  assert.equal(p.telefoon, "+31 24 123 4567");
  assert.equal(p.website, "https://example.nl/");
  assert.deepEqual(p.openingstijden, { maandag: ["11:00–02:00"] });
  assert.equal(p.status, null, "'Honden toegestaan' op [88][0] is geen status");
});

test("oude plek van openingstijden, doorverwijs-URL en echte status", () => {
  const [p] = ontleedZoekantwoord(
    antwoord([zaak({ uren: null, oudeUren: [["dinsdag", ["16:00–01:00"]]], website: "/url?q=https://kroeg.nl/&sa=X", status: "CLOSED" })]),
  );
  assert.deepEqual(p.openingstijden, { dinsdag: ["16:00–01:00"] });
  assert.equal(p.website, "https://kroeg.nl/");
  assert.equal(p.status, "CLOSED");
});

test("ontbrekende velden worden null, geen fout", () => {
  const [p] = ontleedZoekantwoord(antwoord([zaak({ telefoon: null, uren: null, adres: null })]));
  assert.equal(p.telefoon, null);
  assert.equal(p.openingstijden, null);
  assert.equal(p.adres, null);
});

test("leeg antwoord en geblokkeerd antwoord", () => {
  assert.deepEqual(ontleedZoekantwoord(")]}'\n[[\"kroeg\"]]"), []);
  assert.throws(() => ontleedZoekantwoord("<html>unusual traffic</html>"), OnverwachtAntwoord);
  assert.throws(() => ontleedZoekantwoord(")]}'\n{kapot"), OnverwachtAntwoord);
});

test("cid en schone naam", () => {
  assert.equal(cidUitDataId("0x1:0xff"), "255");
  assert.equal(cidUitDataId("onzin"), null);
  assert.equal(schoneNaam("Bar GLITCH 🍸"), "Bar GLITCH");
  assert.equal(schoneNaam("🍺"), "🍺");
});
