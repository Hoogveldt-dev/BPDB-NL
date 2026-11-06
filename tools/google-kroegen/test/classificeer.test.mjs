import { test } from "node:test";
import assert from "node:assert/strict";
import { classificeer } from "../bron/classificeer.mjs";

test("kroegcategorie als hoofdcategorie is zeker", () => {
  assert.deepEqual(classificeer(["Café", "Koffiehuis"]), { soort: "pub", zekerheid: "hoog" });
  assert.deepEqual(classificeer(["Cocktailbar", "Bar"]), { soort: "bar", zekerheid: "hoog" });
  assert.deepEqual(classificeer(["Ierse pub"]), { soort: "pub", zekerheid: "hoog" });
  assert.deepEqual(classificeer(["Irish pub"]), { soort: "pub", zekerheid: "hoog" });
});

test("kroegcategorie op plek 2 of 3 is middel, daarna niet", () => {
  assert.deepEqual(classificeer(["Brouwerij", "Café", "Restaurant"]), { soort: "pub", zekerheid: "middel" });
  assert.deepEqual(classificeer(["Restaurant", "Biertuin"]), { soort: "biergarten", zekerheid: "middel" });
  assert.deepEqual(classificeer(["Restaurant", "Lunchroom", "Hotel", "Bar"]), { soort: null, zekerheid: null });
});

test("geen kroegen", () => {
  assert.equal(classificeer(["Restaurant"]).soort, null);
  assert.equal(classificeer(["Koffiehuis", "Bakkerij"]).soort, null);
  assert.equal(classificeer(["Cannabiswinkel", "Koffiehuis", "Loungebar"]).soort, null);
  assert.equal(classificeer(["IJssalon", "Cocktailbar", "Delicatessenwinkel"]).soort, null);
  assert.equal(classificeer(["Bierwinkel", "Café"]).soort, null);
  assert.equal(classificeer([]).soort, null);
});

test("nachtclubs alleen met clubs", () => {
  assert.equal(classificeer(["Nachtclub"]).soort, null);
  assert.deepEqual(classificeer(["Nachtclub"], { clubs: true }), { soort: "nightclub", zekerheid: "hoog" });
  assert.deepEqual(classificeer(["Café", "Dansclub", "Nachtclub"]), { soort: "pub", zekerheid: "hoog" });
});
