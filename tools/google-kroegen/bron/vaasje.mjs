// Kies uit de bierregels van een kaart de spelprijs: de goedkoopste pils van de tap
// in een vaasje (25 cl). Andere maten rekenen we hier niet om: liever geen prijs
// dan een verkeerde. Zonder maat telt alleen het woord "vaasje" of "vaas" (hetzelfde glas op Nederlandse kaarten,
// naast "fluit" voor het kleinere glas).

const PILS = /\b(hertog jan|heineken|grolsch|amstel|brand|jupiler|bavaria|warsteiner|gulpener|lindeboom|alfa|budels|dommelsch|pils|pilsner|lager|stella)\b/i;
const NIET_PILS = /\b(0[.,]0|alcoholvrij|radler|weizen|wit|blond|tripel|dubbel|ipa|bock|kriek|rose|rosé)\b/i;

/**
 * @param {Array<{merk?:string, omschrijving?:string, cl?:number|null, prijs?:number|null, tap?:boolean, pils?:boolean}>} regels
 * @returns {{merk:string, volume_cl:25, prijs_cent:number, zekerheid:"hoog"|"middel"} | null}
 */
export function kiesVaasje(regels) {
  const kandidaten = [];
  for (const r of regels || []) {
    const naam = `${r.merk || ""} ${r.omschrijving || ""}`.trim();
    const prijs = Number(r.prijs);
    if (!naam || !Number.isFinite(prijs)) continue;
    const prijsCent = Math.round(prijs * 100);
    if (prijsCent < 150 || prijsCent > 1200) continue; // geen vaasje
    if (r.tap === false) continue;
    const isPils = r.pils === true || (r.pils !== false && PILS.test(naam));
    if (!isPils || NIET_PILS.test(naam)) continue;
    const cl = r.cl == null ? null : Number(r.cl);
    let zekerheid;
    if (cl === 25) zekerheid = r.tap === true ? "hoog" : "middel";
    else if (cl == null && /\bvaas(je)?\b/i.test(naam)) zekerheid = "middel";
    else continue;
    // vak: waar de regel op de foto staat, voor de uitsnede bij het nakijken
    kandidaten.push({ merk: schoonMerk(r.merk || naam), volume_cl: 25, prijs_cent: prijsCent, zekerheid, ...(r.vak ? { vak: r.vak } : {}) });
  }
  kandidaten.sort((a, b) => a.prijs_cent - b.prijs_cent || (a.zekerheid === "hoog" ? -1 : 1));
  return kandidaten[0] || null;
}

function schoonMerk(m) {
  return m.replace(/\b(van de tap|tap|vaasje|vaas|fluitje|fluit|pint|\d+([.,]\d+)?\s*(cl|l))\b/gi, "").replace(/\s+/g, " ").trim();
}
