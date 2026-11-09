// Vaste controles op de uitkomst, zonder model. Liever geen prijs dan een verkeerde:
// wat hier afvalt, gaat naar twijfels en niet naar de import.

export const PRIJS_MIN_CENT = 200;
export const PRIJS_MAX_CENT = 750;
export const MAX_AFWIJKING = 0.3;

/** Reden om aan een vaasjesprijs te twijfelen, of null. */
export function prijsBuitenBereik(prijsCent) {
  if (prijsCent >= PRIJS_MIN_CENT && prijsCent <= PRIJS_MAX_CENT) return null;
  return `prijs € ${(prijsCent / 100).toFixed(2)} ligt buiten € 2,00 tot € 7,50`;
}

export function mediaan(getallen) {
  const g = getallen.filter(Number.isFinite).sort((a, b) => a - b);
  if (!g.length) return null;
  const m = Math.floor(g.length / 2);
  return g.length % 2 ? g[m] : Math.round((g[m - 1] + g[m]) / 2);
}

/** Reden als een prijs meer dan 30% van de mediaan van de stad afligt, of null. */
export function afwijkingVanMediaan(prijsCent, mediaanCent) {
  if (!mediaanCent) return null;
  const af = Math.abs(prijsCent - mediaanCent) / mediaanCent;
  if (af <= MAX_AFWIJKING) return null;
  return `prijs wijkt ${Math.round(af * 100)}% af van de mediaan van de stad (€ ${(mediaanCent / 100).toFixed(2)})`;
}

const dag = (d) => (d ? String(d).slice(0, 10) : null);

/**
 * Kiest de datum van een kaart: de opname uit EXIF, tenzij die niet kan.
 * - EXIF later dan de upload of in de toekomst: de klok van de camera stond verkeerd, dus de upload.
 * - EXIF ouder dan tien jaar: wel bewaren, maar markeren.
 * @returns {{datum: string|null, datumBron: "opname"|"upload"|null, klokFout: boolean, oud: boolean, opmerkingen: string[]}}
 */
export function kiesDatum({ opname, geupload, vandaag = new Date().toISOString().slice(0, 10) }) {
  const o = dag(opname);
  const u = dag(geupload);
  const opmerkingen = [];
  let klokFout = false;
  let oud = false;
  let datum = o || u;
  let datumBron = o ? "opname" : u ? "upload" : null;
  if (o && ((u && o > u) || o > vandaag)) {
    klokFout = true;
    opmerkingen.push(`EXIF-datum ${o} ligt na de upload of in de toekomst: klok van de camera stond verkeerd, uploaddatum gebruikt`);
    datum = u && u <= vandaag ? u : null;
    datumBron = datum ? "upload" : null;
  }
  if (datum) {
    const grens = `${Number(vandaag.slice(0, 4)) - 10}${vandaag.slice(4)}`;
    oud = datum < grens;
    if (oud) opmerkingen.push(`foto ouder dan tien jaar (${datum})`);
  }
  return { datum, datumBron, klokFout, oud, opmerkingen };
}

/**
 * Verplaatst prijzen die te ver van de mediaan liggen naar twijfels. De mediaan komt uit de eigen
 * uitvoer (vanaf 5 prijzen) of anders uit mediaanUitDatabase.
 * @param {Array<{prijs_cent:number}>} prijzen  rijen voor importeer_menuprijzen
 */
export function scheidUitschieters(prijzen, mediaanUitDatabase = null) {
  const eigen = prijzen.length >= 5 ? mediaan(prijzen.map((p) => p.prijs_cent)) : null;
  const m = eigen ?? mediaanUitDatabase;
  const goed = [];
  const twijfels = [];
  for (const p of prijzen) {
    const reden = afwijkingVanMediaan(p.prijs_cent, m);
    if (reden) twijfels.push({ ...p, reden });
    else goed.push(p);
  }
  return { goed, twijfels, mediaan: m, mediaanBron: eigen != null ? "eigen uitvoer" : m != null ? "database" : null };
}
