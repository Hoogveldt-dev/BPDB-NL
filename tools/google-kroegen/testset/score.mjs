// Beoordeling per stap van de menukaartpijplijn tegen de labels van de testset.
//
// Elke stap krijgt per foto een van: goed, fout, gemist, twijfel of nvt.
//   fout     het model zag iets wat er niet is (of een verkeerde prijs)
//   gemist   het model zag niets terwijl er wel iets is
//   twijfel  geen bruikbaar antwoord (geen JSON, time-out), of de prijs ging naar twijfels
//   nvt      deze stap zegt bij deze foto niets (bijvoorbeeld lezen zonder verwachte prijs)

export const STAPPEN = ["schiften", "controleren", "lezen", "kiezen", "keten", "datum"];
export const UITSLAGEN = ["goed", "fout", "gemist", "twijfel", "nvt"];

const cent = (euro) => (euro == null ? null : Math.round(Number(euro) * 100));

/** Ja/nee-stap (schiften, controleren): antwoord true, false of null (geen antwoord). */
export function beoordeelJaNee(antwoord, verwacht) {
  if (verwacht == null) return "nvt";
  if (antwoord == null) return "twijfel";
  if (antwoord === verwacht) return "goed";
  return antwoord ? "fout" : "gemist";
}

/** Lezen: staat de verwachte vaasjesprijs tussen de gelezen bieren? bieren null = geen antwoord. */
export function beoordeelLezen(bieren, label) {
  const verwacht = cent(label.vaasje);
  if (!label.bierprijzen || verwacht == null) return "nvt";
  if (bieren == null) return "twijfel";
  if (!bieren.length) return "gemist";
  return bieren.some((b) => cent(b.prijs) === verwacht) ? "goed" : "fout";
}

/** Gekozen prijs (na de tweede mening): { prijs_cent, twijfel } tegen het label. */
export function beoordeelPrijs(uitkomst, label) {
  if (uitkomst == null) return "nvt";
  const verwacht = cent(label.vaasje);
  if (uitkomst.twijfel) return "twijfel";
  if (uitkomst.prijs_cent == null) return verwacht == null ? "goed" : "gemist";
  return uitkomst.prijs_cent === verwacht ? "goed" : "fout";
}

export function beoordeelDatum(datum, label) {
  if (!label.datum) return "nvt";
  if (!datum) return "gemist";
  return datum === label.datum ? "goed" : "fout";
}

/** Telt de uitslagen per stap op: { schiften: { goed: 3, fout: 1, ... }, ... }. */
export function telOp(perFoto) {
  const tel = Object.fromEntries(STAPPEN.map((s) => [s, Object.fromEntries(UITSLAGEN.map((u) => [u, 0]))]));
  for (const f of perFoto) {
    for (const s of STAPPEN) {
      const u = f.uitslag?.[s];
      if (u) tel[s][u] += 1;
    }
  }
  return tel;
}
