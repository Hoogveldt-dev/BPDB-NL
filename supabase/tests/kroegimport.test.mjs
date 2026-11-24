// Test van de kroegimport: ophalen bij OpenStreetMap in de browser (app/overpass.js), de cafés die als kroeg tellen
// en het omzetten van grenzen naar wijken (supabase/functions/osm-import/verwerk.ts en grenzen.ts).
import { multipolygoon } from "../functions/osm-import/grenzen.ts";
import { LOKALE_WIJKEN, cafeIsKroeg, laatOpen, lokaleWijken, verwerk } from "../functions/osm-import/verwerk.ts";
import { OVERPASS, haalOsm, osmQuery } from "../../app/overpass.js";

let goed = 0, fout = 0;
function check(naam, ok, info = "") {
  if (ok) { goed++; console.log(`  ok   ${naam}`); } else { fout++; console.log(`  FOUT ${naam} ${info}`); }
}
const p = (lon, lat) => ({ lon, lat });
const weg = (role, ...punten) => ({ type: "way", role, geometry: punten });

// Een vierkant uit drie wegen, waarvan een de verkeerde kant op loopt, met een gat erin
const vierkant = multipolygoon({ type: "relation", id: 1, members: [
  weg("outer", p(0, 0), p(4, 0), p(4, 4)),
  weg("outer", p(0, 0), p(0, 4)),
  weg("outer", p(4, 4), p(0, 4)),
  weg("inner", p(1, 1), p(2, 1), p(2, 2), p(1, 1)),
  { type: "node", role: "admin_centre" },
] });
const ring = vierkant?.coordinates?.[0]?.[0] ?? [];
check("wegen worden aan elkaar geregen tot een gesloten ring", ring.length === 5 && ring[0].join() === ring[4].join(), JSON.stringify(vierkant));
check("de binnenring hoort bij de buitenring", vierkant?.coordinates?.[0]?.length === 2, JSON.stringify(vierkant));

const twee = multipolygoon({ type: "relation", id: 2, members: [
  weg("outer", p(0, 0), p(1, 0), p(1, 1), p(0, 0)),
  weg("outer", p(5, 5), p(6, 5), p(6, 6), p(5, 5)),
] });
check("twee losse stukken worden twee polygonen", twee?.coordinates?.length === 2, JSON.stringify(twee));

const open = multipolygoon({ type: "relation", id: 3, members: [weg("outer", p(0, 0), p(1, 0), p(1, 1))] });
check("een grens die niet sluit wordt overgeslagen", open === null, JSON.stringify(open));

// Cafés in België: echte kroegen uit Gent mee, koffiezaken en ketens niet (tags zoals in OpenStreetMap, november 2026)
const cafe = (name, extra = {}) => ({ amenity: "cafe", name, ...extra });
const kroegen = [
  cafe("'T Dreupelkot"), cafe("'t Vosken"), cafe("t Schoonzicht", { opening_hours: "Tu,We 16:00-25:00; Fr,Sa 16:00-25:00; Su 16:00-22:00" }),
  cafe("Café Folklore"), cafe("Herberg Macharius", { opening_hours: "Fr 19:30-24:00; Su 15:00-21:00" }),
  cafe("Café Copain", { opening_hours: "We 11:30-00:00; Th-Fr 00:00-01:00, 11:30-00:00" }), cafe("Sportbar Keiskant"),
  cafe("Het Gouden Hoofd", { opening_hours: "Tu-Su 11:00-00:00", cuisine: "regional" }), cafe("Den Johnny"),
];
const geenKroegen = [
  cafe("Starbucks", { brand: "Starbucks", cuisine: "coffee_shop" }), cafe("IzyCoffee", { opening_hours: "Mo-Su,PH 08:00-22:00", brand: "IzyCoffee" }),
  cafe("Café Labath", { opening_hours: "Mo-Fr 08:00-17:30; Sa-Su 09:00-17:30" }), cafe("Peaberry Coffeebar", { bar: "yes" }),
  cafe("Bar Bidon", { cuisine: "coffee_shop;breakfast" }), cafe("QBap", { opening_hours: "Mo-Sa 12:00-22:30", cuisine: "turkish" }),
  cafe("Bargino", { shop: "gift" }), cafe("Klaverblad"), cafe("Krookcafé", { opening_hours: "Mo-We,Fr 10:00-19:00; Th 10:00-21:00" }),
];
for (const t of kroegen) check(`café als kroeg: ${t.name}`, cafeIsKroeg(t) === true);
for (const t of geenKroegen) check(`café geen kroeg: ${t.name}`, cafeIsKroeg(t) === false);
check("openingstijden tot na middernacht tellen als laat", laatOpen("Fr-Sa 20:00-03:00") === true && laatOpen("Mo-Fr 09:00-18:00") === false && laatOpen("sunrise-sunset") === null);

// verwerk: relatie gevonden, kroegen met coördinaten, alleen cafés die op een kroeg lijken, deelgemeenten als wijken
const elementen = [
  { type: "relation", id: 897671 },
  { type: "node", id: 1, lat: 51.05, lon: 3.72, tags: { amenity: "pub", name: "Het Waterhuis", "addr:street": "Groentenmarkt", "addr:housenumber": "9" } },
  { type: "way", id: 2, center: { lat: 51.06, lon: 3.73 }, tags: { amenity: "bar", name: "Ringo" } },
  { type: "node", id: 3, lat: 51.05, lon: 3.72, tags: { amenity: "cafe", name: "'t Vosken" } },
  { type: "node", id: 4, lat: 51.05, lon: 3.72, tags: { amenity: "cafe", name: "Starbucks", brand: "Starbucks" } },
  { type: "node", id: 5, lat: 51.05, lon: 3.72, tags: { amenity: "pub" } },
  { type: "node", id: 6, lat: 51.05, lon: 3.72, tags: { amenity: "restaurant", name: "Pakhuis" } },
  { type: "relation", id: 3134191, tags: { boundary: "administrative", name: "Ledeberg" }, members: [weg("outer", p(0, 0), p(1, 0), p(1, 1), p(0, 0))] },
];
const v = verwerk(elementen, "Gent", true);
check("verwerk vindt de gemeente", v.gevonden === true);
check("verwerk: pub, bar en een café dat op een kroeg lijkt; geen keten, naamloze of restaurant",
  v.kroegen.map((k) => k.naam).join() === "Het Waterhuis,Ringo,'t Vosken" && v.cafes === 1, JSON.stringify(v.kroegen));
check("verwerk: adres en het midden van een gebouw", v.kroegen[0].adres === "Groentenmarkt 9" && v.kroegen[1].lat === 51.06 && v.kroegen[1].osm_id === "way/2");
check("verwerk: de deelgemeente wordt een wijk van Gent", v.wijken?.features.length === 1 && v.wijken.features[0].properties.wijkcode === "OSM-R3134191" && v.wijken.features[0].properties.gemeentenaam === "Gent");
check("verwerk in Nederland: geen wijken uit OpenStreetMap (die komen van het CBS)", verwerk(elementen, "Nijmegen", false).wijken === null);
check("verwerk zonder de gemeente-relatie: niet gevonden", verwerk(elementen.slice(1), "Gent", true).gevonden === false);

// Eigen wijkindeling van een stad (Gent: stadswijken van data.stad.gent)
const vlak = { type: "Polygon", coordinates: [[[3.72, 51.04], [3.73, 51.04], [3.73, 51.05], [3.72, 51.04]]] };
const gentWijken = lokaleWijken({ features: [
  { type: "Feature", properties: { wijk: "Binnenstad", wijknr: 1 }, geometry: vlak },
  { type: "Feature", properties: { wijk: "Ledeberg", wijknr: 9 }, geometry: vlak },
  { type: "Feature", properties: { wijk: null, wijknr: 99 }, geometry: vlak },
] }, "BE44021", "Gent");
check("Gent heeft een eigen wijkindeling", !!LOKALE_WIJKEN.BE44021?.url.startsWith("https://data.stad.gent/"));
check("stadswijken krijgen een vaste code, naam en de gemeente; zonder naam overgeslagen",
  gentWijken.features.map((f) => `${f.properties.wijkcode} ${f.properties.wijknaam} ${f.properties.gemeentenaam}`).join() === "BE44021-1 Binnenstad Gent,BE44021-9 Ledeberg Gent", JSON.stringify(gentWijken));

// De query: op code, in België met cafés en deelgemeenten
const qBe = osmQuery({ code: "BE44021", naam: "Gent" }), qNl = osmQuery({ code: "GM0268", naam: "Nijmegen" });
check("query België: ref:INS, cafés en deelgemeenten", qBe.includes('["ref:INS"="44021"]') && qBe.includes("cafe") && qBe.includes('r.r:"subarea"'));
check("query Nederland: ref:gemeentecode, zonder cafés en deelgemeenten", qNl.includes('["ref:gemeentecode"="0268"]') && !qNl.includes("cafe") && !qNl.includes("subarea"));

// Ophalen: de volgende server bij een fout, een time-out of een onvolledig antwoord
const gent = { code: "BE44021", naam: "Gent" };
const nep = (...antwoorden) => {
  const gevraagd = [];
  return { gevraagd, haal: async (url) => {
    gevraagd.push(new URL(url).host);
    const a = antwoorden.shift();
    if (a instanceof Error) throw a;
    return { ok: a.status === 200, status: a.status, json: async () => a.body };
  } };
};
const goedAntwoord = { status: 200, body: { elements: [{ type: "relation", id: 897671 }, elementen[1]] } };
const time = Object.assign(new Error("time-out"), { name: "TimeoutError" });
let n = nep({ status: 406 }, goedAntwoord);
check("ophalen: na een weigering de volgende server", (await haalOsm(gent, { haal: n.haal })).length === 2 && n.gevraagd.join() === "overpass-api.de,maps.mail.ru");
n = nep(time, { status: 200, body: { remark: "runtime error: Query timed out", elements: [] } }, goedAntwoord);
check("ophalen: time-out en onvolledig antwoord tellen als mislukt", (await haalOsm(gent, { haal: n.haal })).length === 2 && n.gevraagd.length === 3);
n = nep({ status: 504 }, { status: 504 }, { status: 429 }, goedAntwoord);
check("ophalen: na een mislukte ronde nog een ronde", (await haalOsm(gent, { haal: n.haal, pauze: 0 })).length === 2 && n.gevraagd.length === 4);
n = nep(...Array(6).fill({ status: 504 }));
const mis = await haalOsm(gent, { haal: n.haal, pauze: 0 }).then(() => null, (e) => e.message);
check("ophalen: na twee rondes een duidelijke fout", /niet bereikbaar/.test(mis ?? "") && n.gevraagd.length === 2 * OVERPASS.length, mis);
n = nep({ status: 200, body: { elements: [] } }, goedAntwoord);
const weg2 = await haalOsm(gent, { haal: n.haal }).then(() => null, (e) => e.message);
check("ophalen: gemeente niet gevonden, dan niet opnieuw proberen", weg2 === "Gent niet gevonden in OpenStreetMap" && n.gevraagd.length === 1, weg2);

console.log(`\n${goed} goed, ${fout} fout`);
if (fout) process.exit(1);
