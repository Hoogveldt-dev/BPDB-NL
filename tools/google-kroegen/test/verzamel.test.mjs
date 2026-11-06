import { test } from "node:test";
import assert from "node:assert/strict";
import { verzamel } from "../bron/verzamel.mjs";
import { Gezondheid, StructuurGewijzigd } from "../bron/gezondheid.mjs";
import { zaak, antwoord } from "./nep-google.mjs";

function nepTransport(paginas) {
  const verzoeken = [];
  return {
    verzoeken,
    async haal(pad) {
      const offset = Number(/!8i(\d+)/.exec(decodeURIComponent(pad))[1]);
      verzoeken.push(offset);
      return paginas(offset);
    },
  };
}

const kroegen = (van, tot, extra = {}) =>
  Array.from({ length: tot - van }, (_, i) => zaak({ naam: `Café ${van + i}`, placeId: `id${van + i}`, ...extra }));

test("pagineert tot een onvolle pagina en ontdubbelt", async () => {
  const t = nepTransport((o) => antwoord(o === 0 ? kroegen(0, 20) : o === 20 ? kroegen(15, 35) : kroegen(35, 40)));
  const { kroegen: uit, verzoeken } = await verzamel({ cellen: [{ lat: 51.85, lon: 5.86 }], celKm: 1.5, zoektermen: ["kroeg"], transport: t, pauzeMs: 0 });
  assert.deepEqual(t.verzoeken, [0, 20, 40]);
  assert.equal(verzoeken, 3);
  assert.equal(uit.length, 40);
});

test("stopt als een pagina niets nieuws brengt", async () => {
  const t = nepTransport(() => antwoord(kroegen(0, 20)));
  await verzamel({ cellen: [{ lat: 51.85, lon: 5.86 }], celKm: 1.5, zoektermen: ["kroeg"], transport: t, pauzeMs: 0 });
  assert.deepEqual(t.verzoeken, [0, 20]);
});

test("filtert op gebied en categorie, en onthoudt zoektermen", async () => {
  const t = nepTransport((o) =>
    o > 0
      ? antwoord([])
      : antwoord([
          zaak({ naam: "Binnen", placeId: "a" }),
          zaak({ naam: "Buiten", placeId: "b", lat: 52.5 }),
          zaak({ naam: "Restaurant", placeId: "c", categorieen: ["Restaurant"] }),
        ]),
  );
  const gebied = { type: "Polygon", coordinates: [[[5.8, 51.8], [5.9, 51.8], [5.9, 51.9], [5.8, 51.9], [5.8, 51.8]]] };
  const { kroegen: uit, genegeerd } = await verzamel({
    cellen: [{ lat: 51.85, lon: 5.86 }], celKm: 1.5, geometrie: gebied, zoektermen: ["kroeg", "bar"], transport: t, pauzeMs: 0,
  });
  assert.deepEqual(uit.map((k) => k.naam), ["Binnen"]);
  assert.deepEqual(uit[0].gevonden_via, ["bar", "kroeg"]);
  assert.equal(uit[0].soort, "pub");
  assert.equal(genegeerd, 1);
});

test("stopt de run als Google de structuur verandert", async () => {
  const t = nepTransport(() => antwoord(kroegen(0, 20, { placeId: null, dataId: null })));
  await assert.rejects(
    verzamel({ cellen: [{ lat: 51.85, lon: 5.86 }], celKm: 1.5, zoektermen: ["kroeg"], transport: t, pauzeMs: 0, gezondheid: new Gezondheid() }),
    StructuurGewijzigd,
  );
});

test("stopt als de meeste antwoorden onleesbaar zijn", async () => {
  const cellen = Array.from({ length: 6 }, () => ({ lat: 51.85, lon: 5.86 }));
  const t = nepTransport(() => "<html>sorry</html>");
  await assert.rejects(verzamel({ cellen, celKm: 1.5, zoektermen: ["kroeg"], transport: t, pauzeMs: 0 }), StructuurGewijzigd);
});
