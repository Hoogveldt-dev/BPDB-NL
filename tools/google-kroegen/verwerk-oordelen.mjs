#!/usr/bin/env node
// Verwerkt de oordelen van de menukaart-controleur in nakijken/<datum>/.
// Goedgekeurde twijfels gaan naar de rijen voor importeer_menuprijzen, afgekeurde prijzen niet,
// en de uitslag van de steekproef komt in het rapport. Zie docs/menukaartprijzen.md, Nakijken.

import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { verwerkOordelen } from "./bron/nakijken.mjs";
import { stuurMenuprijzen } from "./bron/supabase.mjs";

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: { "naar-supabase": { type: "boolean", default: false }, hulp: { type: "boolean", short: "h", default: false } },
});
if (o.hulp || positionals.length !== 1) {
  console.log("Gebruik: node verwerk-oordelen.mjs nakijken/<datum> [--naar-supabase]");
  process.exit(o.hulp ? 0 : 1);
}

const map = positionals[0];
const { prijzen, rapport } = await verwerkOordelen(map);
const uit = join(map, "nagekeken.json");
await writeFile(uit, JSON.stringify({ prijzen, rapport }, null, 2));

console.log(`Twijfels: ${rapport.twijfels}, waarvan ${rapport.twijfels_goedgekeurd} goedgekeurd`);
console.log(`Steekproef: ${rapport.steekproef}, waarvan ${rapport.steekproef_afgekeurd} afgekeurd${rapport.samen_fout ? `; modellen samen fout: ${rapport.samen_fout}` : ""}`);
if (rapport.niet_nagekeken) console.log(`Nog niet nagekeken (geen oordeel.json): ${rapport.niet_nagekeken}`);
for (const a of rapport.afgekeurd) console.log(`  afgekeurd ${a.geval}: ${a.kroeg}, gelezen ${a.gelezen}${a.juiste_prijs ? `, controleur ziet ${a.juiste_prijs}` : ""}. ${a.toelichting}`);
console.log(`\n${prijzen.length} prijzen in ${uit}`);

if (o["naar-supabase"] && prijzen.length) console.log(`Geimporteerd: ${await stuurMenuprijzen(prijzen)}`);
