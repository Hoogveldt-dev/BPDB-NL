import { test } from "node:test";
import assert from "node:assert/strict";
import { leesOordeel, opdracht, verzoek } from "../deepseek-controleur.mjs";

test("de opdracht komt uit de menukaart-controleur, zonder de kop", async () => {
  const o = await opdracht();
  assert.ok(o.startsWith("Je controleert") && !o.includes("model: haiku"));
});

test("het verzoek bevat geval.json en de beelden als afbeelding", () => {
  const v = verzoek("opdracht", { kroeg: "X" }, [["uitsnede.jpg", "QUJD"]]);
  assert.equal(v.messages[0].content, "opdracht");
  assert.ok(v.messages[1].content[0].text.includes('"kroeg": "X"'));
  assert.equal(v.messages[1].content[2].image_url.url, "data:image/jpeg;base64,QUJD");
});

test("een onleesbaar antwoord telt als afgekeurd", () => {
  assert.equal(leesOordeel("```json\n{\"is_menukaart\":true,\"prijs_klopt\":true,\"toelichting\":\"ok\"}\n```").prijs_klopt, true);
  assert.equal(leesOordeel("geen json").prijs_klopt, false);
  assert.equal(leesOordeel('{"is_menukaart":true}').prijs_klopt, false);
});
