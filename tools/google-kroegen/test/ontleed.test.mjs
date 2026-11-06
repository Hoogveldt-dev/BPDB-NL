import { test } from "node:test";
import assert from "node:assert/strict";
import { pad } from "../bron/pad.mjs";
import { ontleedZoekantwoord, OnverwachtAntwoord, schoneNaam, normaliseerTijden } from "../bron/ontleed.mjs";
import { zaak, antwoord } from "./nep-google.mjs";

const WEEK = Object.fromEntries(["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"].map((d) => [d, ["11:00-02:00"]]));

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
  assert.deepEqual(p.categorieen, ["Café"]);
  assert.equal(p.adres, "Grote Markt 1");
  assert.equal(p.postcode, "6511 KA");
  assert.equal(p.plaats, "Nijmegen");
  assert.equal(p.lat, 51.8478);
  assert.equal(p.lon, 5.8634);
  assert.deepEqual(p.openingstijden, WEEK);
  assert.equal(p.status, null, "'Honden toegestaan' op [88][0] is geen status");
  for (const weg of ["beoordeling", "aantal_reviews", "telefoon", "website", "cid"]) assert.ok(!(weg in p), `${weg} hoort er niet in`);
});

test("oude plek van openingstijden en echte status", () => {
  const oud = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"].map((d) => [d, ["16:00–01:00"]]);
  const [p] = ontleedZoekantwoord(antwoord([zaak({ uren: null, oudeUren: oud, status: "CLOSED" })]));
  assert.equal(p.openingstijden.dinsdag[0], "16:00-01:00");
  assert.equal(p.status, "CLOSED");
});

test("openingstijden: gesloten, 24 uur, en liever niets dan iets verkeerds", () => {
  const ruw = { maandag: ["Gesloten"], dinsdag: ["24 uur geopend"], woensdag: ["9:00–17:00", "19:00–23:30"], donderdag: ["16:00–02:00"], vrijdag: ["16:00–03:00"], zaterdag: ["14:00–03:00"], zondag: ["14:00–01:00"] };
  const t = normaliseerTijden(ruw);
  assert.deepEqual(t.maandag, []);
  assert.deepEqual(t.dinsdag, ["00:00-24:00"]);
  assert.deepEqual(t.woensdag, ["09:00-17:00", "19:00-23:30"]);
  assert.equal(normaliseerTijden({ ...ruw, maandag: ["Op afspraak"] }), null);
  assert.equal(normaliseerTijden({ maandag: ["16:00–02:00"] }), null, "alle 7 dagen nodig");
});

test("ontbrekende velden worden null, geen fout", () => {
  const [p] = ontleedZoekantwoord(antwoord([zaak({ uren: null, adres: null })]));
  assert.equal(p.openingstijden, null);
  assert.equal(p.adres, null);
});

test("leeg antwoord en geblokkeerd antwoord", () => {
  assert.deepEqual(ontleedZoekantwoord(")]}'\n[[\"kroeg\"]]"), []);
  assert.throws(() => ontleedZoekantwoord("<html>unusual traffic</html>"), OnverwachtAntwoord);
  assert.throws(() => ontleedZoekantwoord(")]}'\n{kapot"), OnverwachtAntwoord);
});

test("schone naam", () => {  assert.equal(schoneNaam("Bar GLITCH 🍸"), "Bar GLITCH");
  assert.equal(schoneNaam("🍺"), "🍺");
});
