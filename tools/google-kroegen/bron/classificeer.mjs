// Is dit een kroeg? Google geeft alleen gelokaliseerde categorienamen, dus we
// werken met namen in het Nederlands en Engels. De lijst is opgesteld uit de
// categorieen die Google op 6 november 2026 in Nijmegen teruggaf.
//
// zekerheid "hoog": de hoofdcategorie is een kroegcategorie.
// zekerheid "middel": een kroegcategorie staat op plek 2 of 3.
// Anders null: geen kroeg (of te onzeker).

const SOORT = new Map(
  Object.entries({
    // OSM amenity=pub: het Nederlandse bruine/gewone cafe
    "café": "pub", "bruin café": "pub", "biercafé": "pub", "eetcafé": "pub", "brouwerijcafé": "pub",
    "proeflokaal": "pub", "studentencafé": "pub", "feestcafé": "pub", "bierzaal": "pub",
    "pub": "pub", "ierse pub": "pub", "engelse pub": "pub", "gastropub": "pub",
    "irish pub": "pub", "beer hall": "pub", "brewpub": "pub",
    // OSM amenity=bar
    "bar": "bar", "cocktailbar": "bar", "wijnbar": "bar", "loungebar": "bar", "sportbar": "bar",
    "karaokebar": "bar", "homobar": "bar", "lesbische bar": "bar", "tiki bar": "bar", "whiskybar": "bar",
    "hotelbar": "bar", "bar met live muziek": "bar", "dansbar": "bar", "biljartcafé": "pub",
    "cocktail bar": "bar", "wine bar": "bar", "lounge": "bar", "sports bar": "bar", "karaoke bar": "bar",
    "gay bar": "bar", "whiskey bar": "bar", "hotel bar": "bar", "live music bar": "bar",
    // OSM amenity=biergarten
    "biertuin": "biergarten", "beer garden": "biergarten",
    // OSM amenity=nightclub (alleen met --clubs)
    "nachtclub": "nightclub", "discotheek": "nightclub", "dansclub": "nightclub",
    "night club": "nightclub", "dance club": "nightclub",
  }),
);

// Nooit een kroeg, ook niet als er "bar" naast staat. In Nederland is een coffeeshop een cannabiswinkel.
const NOOIT = new Set(["cannabiswinkel", "coffeeshop", "cannabis store"]);

// Is de hoofdcategorie een winkel of ijssalon, dan telt een kroegcategorie verderop niet
// ("IJssalon, Cocktailbar"; "Restaurant, Biertuin, Bierwinkel" mag wel).
const WINKEL = /winkel|ijssalon|bakkerij|supermarkt|slijterij|\bstore\b|\bshop\b|ice cream/;

export function classificeer(categorieen, { clubs = false } = {}) {
  const cats = (categorieen ?? []).map((c) => c.toLowerCase().trim());
  if (cats.some((c) => NOOIT.has(c))) return { soort: null, zekerheid: null };
  const plekken = cats.length && WINKEL.test(cats[0]) ? 1 : 3;
  for (let i = 0; i < Math.min(cats.length, plekken); i++) {
    const soort = SOORT.get(cats[i]);
    if (!soort || (soort === "nightclub" && !clubs)) continue;
    return { soort, zekerheid: i === 0 ? "hoog" : "middel" };
  }
  return { soort: null, zekerheid: null };
}
