// Test van het omzetten van OpenStreetMap-grenzen naar GeoJSON (supabase/functions/osm-import/grenzen.ts),
// waarmee de import de Belgische deelgemeenten als wijken laadt.
import { multipolygoon } from "../functions/osm-import/grenzen.ts";

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

console.log(`\n${goed} goed, ${fout} fout`);
if (fout) process.exit(1);
