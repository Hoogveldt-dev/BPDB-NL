// Veldgezondheid: per veld bijhouden hoe vaak het gevuld is. Als Google de
// structuur verandert, zie je dat meteen en stopt de run voordat er halve data
// in de database komt. Idee van modules/selector_health.py uit
// georgekhananaev/google-reviews-scraper-pro (MIT).

export const VERPLICHT = ["naam", "place_id", "lat", "lon", "categorieen"];
const OPTIONEEL = ["adres", "postcode", "openingstijden"];

export class StructuurGewijzigd extends Error {}

export class Gezondheid {
  constructor({ drempel = 0.9, minimum = 20 } = {}) {
    this.drempel = drempel;
    this.minimum = minimum;
    this.totaal = 0;
    this.gevuld = Object.fromEntries([...VERPLICHT, ...OPTIONEEL].map((v) => [v, 0]));
    this.antwoorden = 0;
    this.misluktAntwoord = 0;
  }

  antwoord(gelukt) {
    this.antwoorden++;
    if (!gelukt) this.misluktAntwoord++;
  }

  plaats(p) {
    this.totaal++;
    for (const v of Object.keys(this.gevuld)) {
      const w = p[v];
      if (w != null && !(Array.isArray(w) && w.length === 0)) this.gevuld[v]++;
    }
  }

  percentages() {
    return Object.fromEntries(
      Object.entries(this.gevuld).map(([v, n]) => [v, this.totaal ? Math.round((100 * n) / this.totaal) : 0]),
    );
  }

  /** Gooit StructuurGewijzigd als een verplicht veld te vaak ontbreekt. */
  controleer() {
    if (this.antwoorden >= 5 && this.misluktAntwoord / this.antwoorden > 0.5) {
      throw new StructuurGewijzigd(`${this.misluktAntwoord} van ${this.antwoorden} antwoorden onleesbaar`);
    }
    if (this.totaal < this.minimum) return;
    const zwak = VERPLICHT.filter((v) => this.gevuld[v] / this.totaal < this.drempel);
    if (zwak.length) {
      const pct = this.percentages();
      throw new StructuurGewijzigd(
        `Verplichte velden te vaak leeg: ${zwak.map((v) => `${v} ${pct[v]}%`).join(", ")}. ` +
          "Google heeft waarschijnlijk de structuur veranderd; controleer de paden in bron/ontleed.mjs.",
      );
    }
  }
}
