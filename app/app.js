// Bierkoers: echte app op Supabase.
// Kaart (MapLibre + OpenFreeMap), inloggen, prijzen melden en bevestigen, foto's, realtime,
// inchecken met een eigen kaart (Mijn kroegen) en een kroegentochtplanner.
// Alles in de stijl van een beurs: lichtkrant, tickercodes, koersverschil en de Pilsindex van de stad.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY, STAD, KAARTSTIJL } from "./config.js";

const maplibregl = window.maplibregl;

// Een fout van een inloglink staat in de adresbalk (#error_code=otp_expired of ?error_code=...).
// Lees die uit voordat Supabase de adresbalk bijwerkt.
const urlFout = (() => {
  const p = new URLSearchParams(location.hash.slice(1) || location.search);
  return p.get("error_code") || p.get("error_description") || p.get("error");
})();

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Een oude inloglink komt terug met ?code=; die wisselt supabase-js zelf in
    detectSessionInUrl: true,
    flowType: "pkce",
  },
});

// ---------------------------------------------------------------------------
// Hulpjes
// ---------------------------------------------------------------------------

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const euro = (cent) => cent == null ? "" : "€ " + (cent / 100).toFixed(2).replace(".", ",");
const dagen = (iso) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null;
const wanneer = (iso) => {
  const d = dagen(iso);
  if (d == null) return "";
  if (d === 0) return "vandaag";
  if (d === 1) return "gisteren";
  if (d < 30) return `${d} dagen geleden`;
  return new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
};
const VERSHEID = { fresh: "Vers", stale: "Wordt oud", old: "Oud, controleer", locked: "Op slot", wacht: "Wacht op bevestiging" };
// Het spel vergelijkt de goedkoopste pils van de tap in een vaasje (25 cl). Schenkt een kroeg geen vaasje,
// dan meld je het kleinste glas en rekenen we om naar 25 cl.
const GLAZEN = [{ naam: "Vaasje", cl: 25 }, { naam: "Fluitje", cl: 20 }, { naam: "Fluitje", cl: 22 }, { naam: "Glas", cl: 30 }, { naam: "Glas", cl: 33 }];
const VAASJE = 25;
const MERKEN = ["Heineken", "Amstel", "Grolsch", "Brand", "Bavaria", "Hertog Jan", "Jupiler", "Gulpener"];
const WEEKDOEL = 12;
const STAMGAST_MIN = 2; // gelijk aan de drempel in de view kroeg_stamgast
const INCHECK_M = 75; // gelijk aan de grens in private.inchecken
const TOCHT_STRAAL_M = 2000;
const ICON_PIN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><path d="m9 10 2 2 4-4"/></svg>`;
const ICON_ROUTE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16"/></svg>`;
const ICON_GLAS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h10v15a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M16 8h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M9 9v8M12.5 9v8"/></svg>`;

function toast(msg, pts) {
  const t = $("#toast");
  t.innerHTML = esc(msg) + (pts ? `<span class="pts">${pts > 0 ? "+" : ""}${pts}</span>` : "");
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), 3200);
}

const meters = (d) => d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1).replace(".", ",")} km`;
const keer = (n) => (n === 1 ? "1 keer" : `${n} keer`);
const isVandaag = (iso) => iso && new Date(iso).toDateString() === new Date().toDateString();

function afstand(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// ---------------------------------------------------------------------------
// Staat
// ---------------------------------------------------------------------------

const state = {
  tab: "kaart",
  kroegen: [],
  stad: null,
  selected: null,
  form: null,
  filter: "alles",
  zoek: "",
  periode: "week",
  sessie: null,
  profiel: null,
  pos: null,
  // Na het versturen van een code: { email, soort, naam }
  inlog: null,
  // Wat in Supabase aanstaat; bijgewerkt door laadAanbieders()
  aanbieders: { google: false, apple: false, anoniem: true },
  // Extra bier per kroeg (aanbod_overzicht), de lijst met soorten en het gekozen filter op soort
  aanbod: [],
  biersoorten: [],
  soort: "",
  aanbodForm: null,
  // Openingstijden en open meldingen van de gekozen kroeg (kroeg_info), en het invulscherm voor tijden
  info: null,
  tijdenForm: null,
  mijn: new Map(), // kroeg_id -> { keer, eerste, laatst } uit de view mijn_kroegen (privé)
  modus: "samen", // kaart: "samen" (gezamenlijke mist) of "mijn" (waar jij hebt ingecheckt)
  tocht: null, // { soort: "nieuw" | "goedkoop", aantal, stops: [kroeg], start: [lon, lat], vanaf: "jij" | "centrum" }
  // Koers: prijsgeschiedenis uit kroeg_tijdlijn, punten per kroeg, de Pilsindex en tickercodes (zie koersen())
  koersRuw: [],
  koers: { punten: new Map(), index: null, recent: [] },
  codes: new Map(),
};

// Prijs voor het spel: per vaasje; bij een ander glas omgerekend, met een ≈ ervoor
function spelPrijs(k) {
  if (!k.per25_cent) return "";
  return (k.huidig_volume_cl === VAASJE ? "" : "≈ ") + euro(k.per25_cent);
}

// Wat de kaart en de lijst tonen: de meest recente prijs. Wacht er een melding op bevestiging,
// dan is dat die prijs (met een ? erachter); anders de bevestigde. Het spel (vrijspelen, punten,
// ranglijst, versheid, goedkoopste) draait alleen om de bevestigde prijs.
// Een prijs van een menukaart: eerste stuk geschiedenis, zonder melder; de kroeg blijft op slot
const vanMenukaart = (k) => k.open_bron === "menukaart";
const datumTekst = (d) => new Date(d).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });

function toonPrijs(k) {
  if (k.open_prijs_cent) return { per25: k.open_per25_cent, volume: k.open_volume_cl, onbevestigd: true };
  if (k.per25_cent) return { per25: k.per25_cent, volume: k.huidig_volume_cl, onbevestigd: false };
  return null;
}
function toonPrijsTekst(k) {
  const t = toonPrijs(k);
  if (!t) return "";
  return (t.volume === VAASJE ? "" : "≈ ") + euro(t.per25) + (t.onbevestigd ? "?" : "");
}
// "Heineken · vaasje (25 cl)" of "Grolsch · 33 cl, omgerekend € 3,00 per vaasje"
function glasTekst(merk, volume, per25) {
  return `${esc(merk)} · ${volume === VAASJE ? "vaasje (25 cl)" : `${volume} cl, omgerekend ${euro(per25)} per vaasje`}`;
}

const soortNaam = (code) => state.biersoorten.find((b) => b.code === code)?.naam ?? code;
const aanbodVan = (kroegId) => state.aanbod.filter((a) => a.kroeg_id === kroegId);

// Bij een filter op soort: het goedkoopste bier van die soort in deze kroeg (met prijs), anders het eerste
function soortIn(kroegId) {
  const lijst = aanbodVan(kroegId).filter((a) => a.soort === state.soort);
  return lijst.filter((a) => a.prijs_cent).sort((a, b) => a.prijs_cent - b.prijs_cent)[0] ?? lijst[0] ?? null;
}

const zichtbareKroegen = () => state.soort ? state.kroegen.filter((k) => soortIn(k.id)) : state.kroegen;

// Onthoud e-mail en spelersnaam op dit apparaat, zodat je ze bij de volgende keer niet opnieuw typt.
const onthouden = {
  lees() { try { return JSON.parse(localStorage.getItem("bpdb-inlog") ?? "{}"); } catch { return {}; } },
  schrijf(v) { try { localStorage.setItem("bpdb-inlog", JSON.stringify(v)); } catch { /* privévenster */ } },
};

// Meldingen van Supabase Auth in gewone taal.
function vertaalAuthFout(fout) {
  const m = String(fout?.message ?? fout ?? "").toLowerCase();
  const sec = m.match(/after (\d+) seconds?/);
  if (sec) return `Wacht nog ${sec[1]} seconden voordat je een nieuwe code vraagt.`;
  if (m.includes("expired") || (m.includes("invalid") && (m.includes("token") || m.includes("otp"))))
    return "Deze code klopt niet of is verlopen. Vraag een nieuwe aan.";
  if (m.includes("rate limit")) return "Er zijn te veel inlogmails verstuurd. Probeer het later opnieuw.";
  if (m.includes("anonymous sign-ins are disabled")) return "Meteen beginnen staat nog niet aan. Probeer het later opnieuw.";
  if (m.includes("provider is not enabled") || m.includes("unsupported provider"))
    return "Deze manier van inloggen staat nog niet aan. Gebruik voorlopig je e-mailadres.";
  if (m.includes("manual linking is disabled")) return "Koppelen met Apple of Google staat nog niet aan. Gebruik voorlopig je e-mailadres.";
  if (m.includes("identity") && m.includes("already")) return "Dit Apple- of Google-account hoort al bij een andere speler.";
  if (m.includes("signups not allowed for otp")) return "Dit e-mailadres hoort nog niet bij een account. Begin hierboven en koppel daarna je e-mailadres.";
  if (m.includes("already been registered") || m.includes("email_exists"))
    return "Dit e-mailadres hoort al bij een account. Log uit en log daarmee in; de punten van deze speler gaan dan niet mee.";
  if (m.includes("email") && (m.includes("invalid") || m.includes("validate"))) return "Dit e-mailadres klopt niet.";
  if (m.includes("signups not allowed") || m.includes("signup is disabled")) return "Nieuwe accounts kunnen nu niet worden aangemaakt.";
  if (m.includes("fetch") || m.includes("network")) return "Geen verbinding. Controleer je internet en probeer het opnieuw.";
  return "Inloggen lukte niet. Probeer het nog eens.";
}

// Is de speler iets aan het typen? Dan tekenen we het scherm niet opnieuw, anders verdwijnt de invoer.
function bezigMetTypen() {
  const a = document.activeElement;
  return !!a && body.contains(a) && a.matches("input, select, textarea");
}

// ---------------------------------------------------------------------------
// Koers: de app als beurs. Alleen weergave; het spel en de spelregels blijven zoals ze zijn.
// Een koerspunt is een bekende prijs per vaasje op een datum: een bevestigde melding of een
// menukaart (dezelfde punten als de koersgrafiek). De Pilsindex is de mediaan van de laatst
// bekende prijs per vaasje van alle kroegen in de stad.
// ---------------------------------------------------------------------------

const DAG = 86400000;
const KOERS_TAAL = { op: "↗", af: "↘", gelijk: "→" };
const richting = (d) => (d > 0 ? "op" : d < 0 ? "af" : "gelijk");
const bedrag = (cent) => (Math.abs(cent) / 100).toFixed(2).replace(".", ",");
const procent = (x) => (Math.abs(x) * 100).toFixed(1).replace(".", ",") + "%";

// "▼ 0,20" of "▲ 1,4%"; null als er niets te vergelijken is
function deltaHtml(d, { pct = null, pil = false } = {}) {
  if (d == null) return "";
  const r = richting(d);
  const tekst = pct != null ? procent(pct) : bedrag(d);
  const label = r === "op" ? "duurder" : r === "af" ? "goedkoper" : "gelijk";
  return `<span class="delta ${r}${pil ? " pil" : ""}" title="${label}">${KOERS_TAAL[r]} ${tekst}</span>`;
}

function mediaan(lijst) {
  if (!lijst.length) return null;
  const s = [...lijst].sort((a, b) => a - b), m = s.length >> 1;
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
}

// Tickercode van vier letters per kroeg ("Café De Hemel" wordt HEME), uniek binnen de stad.
const STOPWOORDEN = new Set(["DE", "HET", "T", "CAFE", "EETCAFE", "GRAND", "BAR", "IN", "VAN", "EN", "THE", "OP", "AAN", "BIJ", "PUB", "BRUIN"]);
function maakCodes(kroegen) {
  const codes = new Map(), bezet = new Set();
  for (const k of [...kroegen].sort((a, b) => a.id - b.id)) {
    const woorden = k.naam.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
    const kern = woorden.filter((w) => !STOPWOORDEN.has(w));
    // Te weinig letters zonder stopwoorden ("Bar 2"), dan tellen de stopwoorden mee: BAR2
    const w = kern.join("").length >= 4 ? kern : woorden.length ? woorden : ["KROEG"];
    const alles = w.join("").padEnd(4, "X");
    const kandidaten = (w.length > 1
      ? [w[0].slice(0, 2) + w[1].slice(0, 2), w[0].slice(0, 3) + w[1][0], w[0][0] + w[1].slice(0, 3), w[0].slice(0, 4), alles.slice(0, 4)]
      : [alles.slice(0, 4), alles[0] + alles.slice(2, 5), alles.slice(0, 2) + alles.slice(3, 5)]).filter((c) => c.length === 4);
    let code = kandidaten.find((c) => !bezet.has(c));
    for (let i = 2; !code; i++) { const c = alles.slice(0, 4 - String(i).length) + i; if (!bezet.has(c)) code = c; }
    bezet.add(code); codes.set(k.id, code);
  }
  return codes;
}
const codeVan = (id) => state.codes.get(id) ?? "";
const codeHtml = (id, groot = false) => codeVan(id) ? `<span class="code${groot ? " groot" : ""}">${codeVan(id)}</span>` : "";

// Index op een moment: mediaan van de laatst bekende prijs per kroeg op of voor dat moment
function indexOp(t) {
  const vs = [];
  for (const p of state.koers.punten.values()) {
    let v = null;
    for (const x of p) { if (x.t <= t) v = x.v; else break; }
    if (v != null) vs.push(v);
  }
  return vs.length ? { v: mediaan(vs), n: vs.length } : null;
}

function koersen() {
  const open = new Set(state.kroegen.map((k) => k.id));
  const punten = new Map();
  for (const g of state.koersRuw) {
    if (open.size && !open.has(g.kroeg_id)) continue;
    if (!(g.status === "bevestigd" || g.bron === "menukaart") || g.soort === "check" || !g.volume_cl) continue;
    const lijst = punten.get(g.kroeg_id) ?? [];
    lijst.push({ t: new Date(g.op).getTime(), v: Math.round((g.prijs_cent * 25) / g.volume_cl), bron: g.bron });
    punten.set(g.kroeg_id, lijst);
  }
  for (const p of punten.values()) p.sort((a, b) => a.t - b.t);
  state.koers.punten = punten;
  const nu = Date.now(), stand = indexOp(nu);
  let index = null;
  if (stand) {
    // Bierprijzen gaan zelden omhoog, meestal een keer per jaar. Daarom vergelijkt de index met twaalf maanden terug.
    const jaar = indexOp(nu - 365 * DAG);
    // Verloop sinds de eerste bekende prijs (hooguit vijf jaar): een punt per maand, plus nu
    const eerste = Math.min(...[...punten.values()].map((p) => p[0].t));
    const van = Math.max(eerste, nu - 5 * 365 * DAG);
    const reeks = [];
    for (let t = van; t < nu; t += 30 * DAG) { const i = indexOp(t); if (i) reeks.push({ t, v: i.v }); }
    reeks.push({ t: nu, v: stand.v });
    index = { nu: stand.v, n: stand.n, jaar: jaar?.v ?? null, delta: jaar ? stand.v - jaar.v : null, pct: jaar ? (stand.v - jaar.v) / jaar.v : null, reeks };
  }
  state.koers.index = index;
}

// Koers van een kroeg. Een prijs blijft meestal lang gelijk, dus het belangrijkste is sinds wanneer.
// vastSinds: sinds wanneer de prijs dit bedrag is. delta: de laatste stap ten opzichte van het vorige bedrag.
// recent: die stap was in de afgelopen twaalf maanden; een oudere stap tonen we niet als koersverschil.
function koersVan(id) {
  const p = state.koers.punten.get(id);
  if (!p?.length) return null;
  const nu = p[p.length - 1].v;
  let i = p.length - 1;
  while (i > 0 && p[i - 1].v === nu) i--;
  const vorig = i > 0 ? p[i - 1].v : null;
  const jaren = (Date.now() - p[0].t) / (365 * DAG);
  return {
    nu, vastSinds: p[i].t, vorig, eerst: p[0],
    delta: vorig != null ? nu - vorig : null, pct: vorig != null ? (nu - vorig) / vorig : null,
    recent: vorig != null && p[i].t > Date.now() - 365 * DAG,
    // Gemiddelde stijging per jaar sinds de eerste bekende prijs, pas na een jaar geschiedenis
    perJaar: jaren >= 1 && p[0].v !== nu ? (nu / p[0].v) ** (1 / jaren) - 1 : jaren >= 1 ? 0 : null,
    stappen: p.filter((x, j) => j > 0 && x.v !== p[j - 1].v).length,
  };
}

const maandJaar = (t) => new Date(t).toLocaleDateString("nl-NL", { month: "short", year: "numeric" }).replace(".", "");
const maandKort = (t) => new Date(t).toLocaleDateString("nl-NL", { month: "short" }).replace(".", "");

// Kroegen met een prijsstap in de afgelopen twaalf maanden, nieuwste eerst
function bewegers() {
  return state.kroegen.map((k) => ({ k, c: koersVan(k.id) })).filter((x) => x.c?.recent).sort((a, b) => b.c.vastSinds - a.c.vastSinds);
}

// Kroegen waarvan de prijs het langst gelijk is gebleven
function prijsvast() {
  return state.kroegen.map((k) => ({ k, c: koersVan(k.id) })).filter((x) => x.c).sort((a, b) => a.c.vastSinds - b.c.vastSinds);
}

// Klein trapje in een rij: alleen als de kroeg echt een prijsgeschiedenis heeft. Drie jaar breed, voor elke rij gelijk.
function trapjeHtml(id) {
  const p = state.koers.punten.get(id), c = koersVan(id);
  if (!p || !c?.stappen) return "";
  const W = 46, H = 20, nu = Date.now(), van = nu - 3 * 365 * DAG;
  const vs = p.map((x) => x.v), lo = Math.min(...vs), hi = Math.max(...vs);
  const X = (t) => ((Math.max(t, van) - van) / (nu - van)) * W, Y = (v) => 3 + (H - 6) * (1 - (v - lo) / (hi - lo || 1));
  let d = `M${X(p[0].t)},${Y(p[0].v)}`;
  for (const x of p.slice(1)) d += ` H${X(x.t)} V${Y(x.v)}`;
  d += ` H${W}`;
  return `<svg class="trapje ${c.recent ? richting(c.delta) : ""}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}"/></svg>`;
}

async function laadKoers() {
  // Een menukaart die achterhaald bleek, was op die datum wel de prijs; die telt dus mee.
  // Daarnaast de laatste activiteit voor de lichtkrant: controles komen veel vaker voor dan prijswijzigingen.
  const [{ data, error }, { data: recent }] = await Promise.all([
    sb.from("kroeg_tijdlijn").select("kroeg_id,soort,status,prijs_cent,volume_cl,op,bron")
      .neq("soort", "check").or("status.eq.bevestigd,bron.eq.menukaart").order("op", { ascending: true }).limit(5000),
    sb.from("kroeg_tijdlijn").select("kroeg_id,soort,status,op").eq("status", "bevestigd").order("op", { ascending: false }).limit(20),
  ]);
  if (error) { console.error(error); return; }
  state.koersRuw = data ?? [];
  state.koers.recent = recent ?? [];
  koersen();
  lichtkrant();
  hud();
}

// Lichtkrant bovenin: de Pilsindex en wat er net gebeurde. Tik op een koers om de kroeg te openen.
function lichtkrant() {
  const idx = state.koers.index;
  const s = state.stad;
  const items = [
    `<span class="tk idx"><b>PILSINDEX</b>${idx ? `${euro(idx.nu)} ${idx.delta != null ? `${deltaHtml(idx.delta, { pct: idx.pct })} <span class="zacht">12 mnd</span>` : ""}` : `<span class="zacht">nog geen koers</span>`}</span>`,
  ];
  const gezien = new Set();
  for (const g of state.koers.recent ?? []) {
    const k = state.kroegen.find((x) => x.id === g.kroeg_id), c = koersVan(g.kroeg_id);
    if (!k || !c || gezien.has(k.id)) continue;
    gezien.add(k.id);
    const wat = g.soort === "check" ? `<span class="zacht">✓ klopt nog</span>`
      : g.soort === "eerst" ? `<span class="nieuw">NIEUW</span>`
      : c.recent ? deltaHtml(c.delta) : "";
    items.push(`<button class="tk" data-kroeg="${k.id}" aria-label="${esc(k.naam)} ${euro(c.nu)}"><b>${codeVan(k.id)}</b>${euro(c.nu)} ${wat}</button>`);
  }
  // Prijzen die al lang gelijk zijn, verdienen ook een plek
  const vast = prijsvast().filter((x) => Date.now() - x.c.vastSinds > 365 * DAG && !gezien.has(x.k.id)).slice(0, 3);
  for (const { k, c } of vast) items.push(`<button class="tk" data-kroeg="${k.id}"><b>${codeVan(k.id)}</b>${euro(c.nu)} <span class="zacht">vast sinds ${maandJaar(c.vastSinds)}</span></button>`);
  if (s) items.push(`<span class="tk"><b>${esc(STAD.naam.toUpperCase())}</b>${s.vrijgespeeld}/${s.kroegen} <span class="zacht">vrijgespeeld</span></span>`);
  if (s && s.kroegen - s.vrijgespeeld > 0) items.push(`<span class="tk"><span class="zacht">${s.kroegen - s.vrijgespeeld} kroegen zonder koers · speel ze vrij</span></span>`);
  if (s?.oud) items.push(`<span class="tk"><span class="zacht">${s.oud} koersen ouder dan 90 dagen · controleer ze</span></span>`);
  const een = items.join("");
  const baan = $("#tickerBaan");
  // Twee keer achter elkaar, zodat de lichtkrant naadloos doorloopt; de tweede is alleen decor
  baan.innerHTML = `<div style="display:flex">${een}</div><div style="display:flex" aria-hidden="true" inert>${een}</div>`;
  baan.style.setProperty("--duur", Math.max(25, items.length * 5) + "s");
}

// ---------------------------------------------------------------------------
// Kaart
// ---------------------------------------------------------------------------

const donker = matchMedia("(prefers-color-scheme: dark)");
const map = new maplibregl.Map({
  container: "map",
  style: donker.matches ? KAARTSTIJL.donker : KAARTSTIJL.licht,
  center: STAD.centrum,
  zoom: STAD.zoom,
  attributionControl: { compact: true },
});
let kaartKlaar = false;

function kleur() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return { fresh: v("--fresh"), stale: v("--stale"), old: v("--old"), locked: v("--locked"), wacht: v("--wacht"), accent: v("--accent"), accentInk: v("--accent-ink"), surface: v("--surface"), blue: v("--blue"), op: v("--op"), af: v("--af") };
}

function geojson() {
  return {
    type: "FeatureCollection",
    features: zichtbareKroegen().map((k) => ({
      type: "Feature",
      id: k.id,
      geometry: { type: "Point", coordinates: [k.lon, k.lat] },
      properties: {
        id: k.id,
        naam: k.naam,
        versheid: k.open_melding_id && k.versheid !== "locked" && !k.huidig_prijs_cent ? "wacht" : k.versheid,
        label: state.soort ? (soortIn(k.id)?.prijs_cent ? euro(soortIn(k.id).prijs_cent) : "") : toonPrijsTekst(k),
        bezocht: state.mijn.has(k.id),
        per25: koersVan(k.id)?.nu ?? k.per25_cent ?? 0,
      },
    })),
  };
}

// Samen: kleur is versheid. Koers: groen onder de Pilsindex, goud rond de index, rood erboven.
// Mijn kaart: goud waar je hebt ingecheckt, de rest grijs onder je eigen mist.
function cirkelStijl() {
  const c = kleur();
  if (state.modus === "koers") {
    const idx = state.koers.index?.nu;
    const prijs = [">", ["get", "per25"], 0];
    return {
      "circle-color": ["case", prijs, idx ? ["interpolate", ["linear"], ["/", ["get", "per25"], idx], 0.85, c.af, 1, c.accent, 1.15, c.op] : c.accent, c.locked],
      "circle-opacity": ["case", prijs, 1, 0.35],
      "circle-stroke-color": c.surface,
    };
  }
  if (state.modus === "mijn") {
    return {
      "circle-color": ["case", ["get", "bezocht"], c.accent, c.locked],
      "circle-opacity": ["case", ["get", "bezocht"], 1, 0.4],
      "circle-stroke-color": ["case", ["get", "bezocht"], c.accentInk, c.surface],
    };
  }
  return {
    "circle-color": ["match", ["get", "versheid"], "fresh", c.fresh, "stale", c.stale, "old", c.old, "wacht", c.wacht, c.locked],
    "circle-opacity": ["case", ["==", ["get", "versheid"], "locked"], 0.45, 1],
    "circle-stroke-color": c.surface,
  };
}

function tochtGeojson() {
  const t = state.tocht;
  const feats = [];
  if (t?.stops.length) {
    feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: [t.start, ...t.stops.map((k) => [k.lon, k.lat])] }, properties: {} });
    feats.push({ type: "Feature", geometry: { type: "Point", coordinates: t.start }, properties: { start: true } });
    t.stops.forEach((k, i) => feats.push({ type: "Feature", geometry: { type: "Point", coordinates: [k.lon, k.lat] }, properties: { nr: String(i + 1) } }));
  }
  return { type: "FeatureCollection", features: feats };
}

function kaartLagen() {
  const c = kleur();
  if (map.getSource("kroegen")) return;
  map.addSource("kroegen", { type: "geojson", data: geojson() });
  map.addSource("tocht", { type: "geojson", data: tochtGeojson() });
  map.addLayer({
    id: "tocht-lijn", type: "line", source: "tocht", filter: ["==", ["geometry-type"], "LineString"],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": c.blue, "line-width": 4, "line-opacity": 0.8, "line-dasharray": [1, 1.6] },
  });
  map.addLayer({
    id: "kroeg-halo", type: "circle", source: "kroegen",
    filter: ["==", ["get", "id"], -1],
    paint: { "circle-radius": 16, "circle-color": c.accent, "circle-opacity": 0.35 },
  });
  map.addLayer({
    id: "kroeg-cirkel", type: "circle", source: "kroegen",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3.5, 15, 7, 17, 9],
      "circle-stroke-width": 2,
      ...cirkelStijl(),
    },
  });
  map.addLayer({
    id: "tocht-start", type: "circle", source: "tocht", filter: ["has", "start"],
    paint: { "circle-radius": 7, "circle-color": c.surface, "circle-stroke-width": 4, "circle-stroke-color": c.blue },
  });
  map.addLayer({
    id: "tocht-nr", type: "circle", source: "tocht", filter: ["has", "nr"],
    paint: { "circle-radius": 11, "circle-color": c.blue, "circle-stroke-width": 2, "circle-stroke-color": c.surface },
  });
  map.addLayer({
    id: "tocht-nr-tekst", type: "symbol", source: "tocht", filter: ["has", "nr"],
    layout: { "text-field": ["get", "nr"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-allow-overlap": true },
    paint: { "text-color": "#ffffff" },
  });
  map.addLayer({
    id: "kroeg-prijs", type: "symbol", source: "kroegen", minzoom: state.modus === "koers" ? 13.2 : 14.5,
    filter: ["!=", ["get", "label"], ""],
    layout: {
      "text-field": ["get", "label"],
      "text-font": ["Noto Sans Bold"],
      "text-size": 12,
      "text-offset": [0, -1.4],
      "text-allow-overlap": false,
    },
    paint: { "text-color": donker.matches ? "#f2f2f7" : "#1c1c1e", "text-halo-color": c.surface, "text-halo-width": 1.6 },
  });
  map.on("click", "kroeg-cirkel", (e) => openKroeg(e.features[0].properties.id));
  map.on("mouseenter", "kroeg-cirkel", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "kroeg-cirkel", () => (map.getCanvas().style.cursor = ""));
}

map.on("load", () => {
  kaartKlaar = true;
  kaartLagen();
});
donker.addEventListener("change", () => {
  map.setStyle(donker.matches ? KAARTSTIJL.donker : KAARTSTIJL.licht);
  map.once("styledata", () => kaartLagen());
});

function kaartBijwerken() {
  if (!kaartKlaar) return;
  const src = map.getSource("kroegen");
  if (src) src.setData(geojson());
  map.getSource("tocht")?.setData(tochtGeojson());
  if (map.getLayer("kroeg-halo")) map.setFilter("kroeg-halo", ["==", ["get", "id"], state.selected ?? -1]);
  if (map.getLayer("kroeg-cirkel")) for (const [k, v] of Object.entries(cirkelStijl())) map.setPaintProperty("kroeg-cirkel", k, v);
  // In de koersstand staan de prijzen al eerder op de kaart
  if (map.getLayer("kroeg-prijs")) map.setLayerZoomRange("kroeg-prijs", state.modus === "koers" ? 13.2 : 14.5, 24);
}

// ---------------------------------------------------------------------------
// Sheet met drie standen
// ---------------------------------------------------------------------------

const sheet = $("#sheet");
const wide = () => matchMedia("(min-width: 900px)").matches;
function setDetent(d) {
  sheet.dataset.detent = d;
  if (wide()) return;
  const h = sheet.getBoundingClientRect().height;
  const y = d === "full" ? 0 : d === "half" ? h - innerHeight * 0.48 : h - 150;
  sheet.style.setProperty("--sy", Math.max(0, y) + "px");
  // Het blad schuift omlaag; geef de inhoud onderaan evenveel ruimte, zodat je alles in beeld kunt scrollen
  $("#body").style.paddingBottom = `calc(env(safe-area-inset-bottom) + 24px + ${Math.max(0, y)}px)`;
}
(function sleep() {
  // Slepen kan aan het streepje en aan de tabbladen. Op een tabblad begint slepen pas na 8 px beweging,
  // zodat een gewone tik nog steeds het tabblad kiest.
  let startY = 0, startT = 0, wacht = false, dragging = false, geenKlik = false;
  const grip = (e) => e.target.closest("#grabber, #tabs");
  sheet.addEventListener("pointerdown", (e) => {
    if (wide() || !grip(e)) return;
    wacht = true; dragging = false; startY = e.clientY;
    startT = parseFloat(getComputedStyle(sheet).getPropertyValue("--sy")) || 0;
  });
  sheet.addEventListener("pointermove", (e) => {
    if (!wacht) return;
    if (!dragging) {
      if (Math.abs(e.clientY - startY) < 8) return;
      dragging = true;
      sheet.classList.add("dragging"); sheet.setPointerCapture(e.pointerId);
    }
    sheet.style.setProperty("--sy", Math.max(0, startT + e.clientY - startY) + "px");
  });
  const los = (e) => {
    if (!wacht) return;
    wacht = false;
    if (!dragging) return;
    dragging = false; geenKlik = true; sheet.classList.remove("dragging");
    const dy = e.clientY - startY, d = sheet.dataset.detent;
    const order = ["full", "half", "peek"], i = order.indexOf(d);
    if (dy < -50) setDetent(order[Math.max(0, i - 1)]);
    else if (dy > 50) setDetent(order[Math.min(2, i + 1)]);
    else setDetent(d);
  };
  sheet.addEventListener("pointerup", los);
  sheet.addEventListener("pointercancel", los);
  // Na slepen telt het loslaten niet als tik op een tabblad
  sheet.addEventListener("click", (e) => {
    if (geenKlik) { geenKlik = false; e.stopPropagation(); e.preventDefault(); }
  }, true);
  $("#grabber").addEventListener("click", () => setDetent(sheet.dataset.detent === "full" ? "half" : "full"));
  addEventListener("resize", () => setDetent(sheet.dataset.detent));
})();

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function laadKroegen() {
  const { data, error } = await sb.from("kroeg_kaart").select("*").eq("gemeente", STAD.naam).eq("open", true).order("naam");
  if (error) { console.error(error); toast("Kroegen laden mislukt"); return; }
  state.kroegen = data;
  state.codes = maakCodes(data);
  koersen();
  kaartBijwerken();
  lichtkrant();
}

async function laadStad() {
  const { data } = await sb.from("stad_voortgang").select("*").eq("gemeente", STAD.naam).maybeSingle();
  state.stad = data;
  hud();
  lichtkrant();
}

async function laadProfiel() {
  const uid = state.sessie?.user?.id;
  if (!uid) { state.profiel = null; return; }
  const { data } = await sb.from("ranglijst").select("*").eq("id", uid).maybeSingle();
  const { data: p } = await sb.from("profielen").select("*").eq("id", uid).maybeSingle();
  state.profiel = data ? { ...data, is_beheerder: !!p?.is_beheerder, naam_vast: p?.naam_vast !== false } : null;
}

async function laadMijn() {
  if (!state.sessie) { state.mijn = new Map(); return; }
  const { data, error } = await sb.from("mijn_kroegen").select("*");
  if (error) { console.error(error); return; }
  state.mijn = new Map(data.map((r) => [r.kroeg_id, r]));
  kaartBijwerken();
  hud();
}

// Beursbord linksboven: de Pilsindex met het verschil met twaalf maanden terug, en hoeveel van de stad vrij is.
// Op Mijn kaart: jouw index (mediaan van de kroegen waar je was) en hoeveel kroegen je hebt bezocht.
function hud() {
  const idx = state.koers.index;
  if (state.modus === "mijn") {
    const totaal = state.kroegen.length, mijn = state.kroegen.filter((k) => state.mijn.has(k.id));
    const eigen = mediaan(mijn.map((k) => koersVan(k.id)?.nu).filter(Boolean));
    zetRing(totaal ? Math.round((mijn.length / totaal) * 100) : 0, `${mijn.length} van ${totaal} kroegen bezocht`,
      "Jouw index", eigen, eigen && idx ? eigen - idx.nu : null);
    return;
  }
  const s = state.stad;
  const pct = s && s.kroegen ? Math.round((s.vrijgespeeld / s.kroegen) * 100) : 0;
  zetRing(pct, `${STAD.naam} vrijgespeeld`, "Pilsindex", idx?.nu, idx?.delta, idx?.pct);
}

function zetRing(pct, sub, label, koers, delta, deltaPct) {
  const C = 2 * Math.PI * 15;
  const ring = $("#hudRing");
  ring.style.strokeDasharray = C;
  ring.style.strokeDashoffset = C * (1 - pct / 100);
  $("#hudPct").textContent = pct + "%";
  $("#hudSub").textContent = sub;
  $("#hudLabel").textContent = label;
  $("#hudKoers").textContent = koers ? euro(koers) : "geen koers";
  $("#hudDelta").outerHTML = `<span id="hudDelta">${delta != null && delta !== 0 ? deltaHtml(delta, deltaPct != null ? { pct: deltaPct } : {}) : ""}</span>`;
}

function setModus(m) {
  state.modus = m;
  document.querySelectorAll("#modus button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.modus === m)));
  $("#legenda").hidden = m !== "koers";
  kaartBijwerken();
  hud();
  if (m === "mijn" && !state.sessie) toast("Log in via Ik om je eigen kaart te zien");
}

let vernieuwTimer;
function vernieuw() {
  clearTimeout(vernieuwTimer);
  vernieuwTimer = setTimeout(async () => {
    await Promise.all([laadKroegen(), laadStad(), laadProfiel(), laadAanbod(), laadMijn(), laadKoers()]);
    if (!bezigMetTypen()) draw();
  }, 400);
}

// ---------------------------------------------------------------------------
// Weergaven
// ---------------------------------------------------------------------------

const body = $("#body");

function draw() {
  let html = "";
  if (state.selected != null) html = state.form ? formView() : state.aanbodForm ? aanbodFormView() : state.tijdenForm ? tijdenFormView() : detailView();
  else if (state.tocht) html = tochtView();
  else if (state.tab === "kaart") html = lijstView();
  else if (state.tab === "beurs") html = '<div class="empty">Laden…</div>';
  else if (state.tab === "rang") html = '<div class="empty">Laden…</div>';
  else if (state.tab === "ik") html = ikView();
  body.innerHTML = html;
  if (state.selected != null && !state.form && !state.aanbodForm && !state.tijdenForm) { laadTijdlijn(state.selected); laadKroegInfo(state.selected); }
  else if (state.selected == null && state.tab === "beurs") beursView();
  else if (state.selected == null && state.tab === "rang") rangView();
  $("#tabIk").textContent = state.profiel ? state.profiel.naam.slice(0, 10) : "Ik";
}

function kroegVersheid(k) {
  if (k.open_melding_id && !k.huidig_prijs_cent && !vanMenukaart(k)) return "wacht";
  return k.versheid;
}

function rowHtml(k) {
  const v = kroegVersheid(k);
  const d = state.pos ? Math.round(afstand(state.pos, [k.lon, k.lat])) : null;
  const sub = [k.wijk, d != null ? meters(d) : null, VERSHEID[v], state.mijn.has(k.id) ? "bezocht" : null].filter(Boolean).join(" · ");
  return `<li><button class="row" data-kroeg="${k.id}">
    <span class="dot ${v}"></span>
    <span class="row-main"><span class="row-title">${codeHtml(k.id)}${esc(k.naam)}</span><span class="row-sub">${esc(sub)}</span></span>
    ${state.soort ? "" : trapjeHtml(k.id)}${prijsKolom(k)}
  </button></li>`;
}

function prijsKolom(k) {
  if (state.soort) {
    const a = soortIn(k.id);
    return a?.prijs_cent ? `<span class="price">${euro(a.prijs_cent)}<small>${a.volume_cl} cl</small></span>` : "";
  }
  const t = toonPrijs(k);
  if (!t) return "";
  // Onder een bevestigde prijs: de stap van het afgelopen jaar, of sinds wanneer de prijs al gelijk is
  const c = !t.onbevestigd ? koersVan(k.id) : null;
  const onder = c?.recent
    ? `<small class="delta ${richting(c.delta)}">${KOERS_TAAL[richting(c.delta)]} ${bedrag(c.delta)} · ${maandKort(c.vastSinds)}</small>`
    : c && Date.now() - c.vastSinds > 365 * DAG ? `<small>vast sinds ${new Date(c.vastSinds).getFullYear()}</small>`
    : `<small>${vanMenukaart(k) ? "menukaart" : t.onbevestigd ? "nog niet bevestigd" : "per vaasje"}</small>`;
  return `<span class="price">${toonPrijsTekst(k)}${onder}</span>`;
}

function lijstView() {
  const F = [
    { id: "alles", naam: "Alles", f: () => true },
    { id: "slot", naam: "Op slot", f: (k) => k.versheid === "locked" },
    { id: "oud", naam: "Oud (90+ d)", f: (k) => k.versheid === "old" },
    { id: "wacht", naam: "Te bevestigen", f: (k) => k.open_melding_id && !vanMenukaart(k) },
    { id: "goedkoop", naam: "Goedkoopst", f: (k) => k.per25_cent },
    { id: "prijsvast", naam: "Langst prijsvast", f: (k) => koersVan(k.id) },
    { id: "verhoogd", naam: "Dit jaar verhoogd", f: (k) => koersVan(k.id)?.recent },
    ...(state.sessie ? [{ id: "nieuw", naam: "Nog niet bezocht", f: (k) => !state.mijn.has(k.id) }] : []),
  ];
  const f = F.find((x) => x.id === state.filter) ?? F[0];
  const q = state.zoek.trim().toLowerCase();
  // Met een soort gekozen: "Goedkoopst" sorteert op de prijs van die soort; kroegen zonder prijs ervan achteraan
  const prijsVoor = (k) => state.soort ? (soortIn(k.id)?.prijs_cent ?? Infinity) : k.per25_cent;
  let rows = zichtbareKroegen()
    .filter((k) => state.soort && state.filter === "goedkoop" ? true : f.f(k))
    .filter((k) => !q || k.naam.toLowerCase().includes(q) || (k.wijk ?? "").toLowerCase().includes(q));
  if (state.filter === "goedkoop") rows.sort((a, b) => prijsVoor(a) - prijsVoor(b));
  else if (state.filter === "prijsvast") rows.sort((a, b) => koersVan(a.id).vastSinds - koersVan(b.id).vastSinds);
  else if (state.filter === "verhoogd") rows.sort((a, b) => koersVan(b.id).vastSinds - koersVan(a.id).vastSinds);
  else if (state.pos) rows.sort((a, b) => afstand(state.pos, [a.lon, a.lat]) - afstand(state.pos, [b.lon, b.lat]));
  const leeg = state.kroegen.length === 0
    ? `<div class="empty">Nog geen kroegen geladen.<br><span class="small">Een beheerder importeert ze via het tabblad Ik.</span></div>`
    : state.soort ? `<div class="empty">Nog geen kroeg met ${esc(soortNaam(state.soort))} gemeld.<br><span class="small">Weet je er een? Voeg het toe bij de kroeg onder "Ook op de tap".</span></div>`
    : state.filter === "verhoogd" && !q ? `<div class="empty">Dit jaar heeft nog geen kroeg de prijs verhoogd.<br><span class="small">Of niemand heeft het nog gemeld.</span></div>`
    : state.filter === "prijsvast" && !q ? `<div class="empty">Nog geen koersen.</div>`
    : `<div class="empty">Niets gevonden.</div>`;
  // Alleen soorten die ergens getapt worden
  const soorten = state.biersoorten.filter((b) => state.aanbod.some((a) => a.soort === b.code) || b.code === state.soort);
  return `<input class="search" type="search" placeholder="Zoek een kroeg of wijk" value="${esc(state.zoek)}" data-zoek>
    <button class="row tocht-link" data-tocht-open><span class="ic-sm">${ICON_ROUTE}</span><span class="row-main"><span class="row-title">Plan een kroegentocht</span><span class="row-sub">Langs de goedkoopste kroegen of waar je nog niet was</span></span><span class="muted">›</span></button>
    <div class="chips">${F.map((x) => `<button class="chip" data-filter="${x.id}" aria-pressed="${x.id === f.id}">${x.naam}</button>`).join("")}</div>
    ${soorten.length ? `<select class="soortkeuze" data-soort aria-label="Filter op bier dat getapt wordt">
      <option value="">Op de tap: alle kroegen</option>
      ${soorten.map((b) => `<option value="${b.code}" ${b.code === state.soort ? "selected" : ""}>Op de tap: ${esc(b.naam)}</option>`).join("")}
    </select>` : ""}
    ${rows.length ? `<ul class="list">${rows.slice(0, 150).map(rowHtml).join("")}</ul>` : leeg}`;
}

function detailView() {
  const k = state.kroegen.find((x) => x.id === state.selected);
  if (!k) return `<button class="back" data-back>‹ Terug</button><div class="empty">Kroeg niet gevonden.</div>`;
  const v = kroegVersheid(k);
  const ingelogd = !!state.sessie;
  let actie = "";
  if (k.open_melding_id && vanMenukaart(k)) {
    actie = `<div class="small" style="margin-top:8px">Ben je hier? Bevestig de prijs ter plaatse en speel de kroeg vrij zodra een andere speler het ook bevestigt.</div>
      <div class="btns">
      <button class="btn primary" data-menuklopt="${k.id}" ${ingelogd ? "" : "disabled"}>Klopt, ik ben er</button>
      <button class="btn" data-form="nieuw" ${ingelogd ? "" : "disabled"}>Prijs is anders</button></div>`;
  } else if (k.open_melding_id) {
    actie = `<div class="card" id="openMelding"><div class="muted small">Melding laden…</div></div>`;
  } else if (k.versheid === "locked") {
    actie = `<div class="btns"><button class="btn primary" data-form="nieuw" ${ingelogd ? "" : "disabled"}>Speel vrij met een prijs</button></div>`;
  } else {
    actie = `<div class="btns">
      <button class="btn good" data-klopt="${k.id}" ${ingelogd && !anoniem() ? "" : "disabled"}>Klopt nog</button>
      <button class="btn" data-form="nieuw" ${ingelogd ? "" : "disabled"}>Prijs is anders</button></div>
      ${anoniem() ? `<div class="small muted" style="margin-top:8px">Koppel je e-mailadres (tabblad Ik) om prijzen te controleren.</div>` : ""}`;
  }
  return `<button class="back" data-back>‹ Terug</button>
    <div class="koerskop">${codeHtml(k.id, true)}<span class="badge ${v}">${VERSHEID[v]}</span></div>
    <h2>${esc(k.naam)}</h2>
    <div class="muted small">${esc([k.adres, k.wijk].filter(Boolean).join(" · "))}</div>
    <div class="card">
      ${k.open_prijs_cent && vanMenukaart(k) ? `
        <div class="big-price">${euro(k.open_prijs_cent)}<span class="onbevestigd">?</span></div>
        <div class="muted">${glasTekst(k.open_merk, k.open_volume_cl, k.open_per25_cent)}</div>
        <div class="muted small">Volgens de menukaart van ${datumTekst(k.open_op)}${k.open_bron_omschrijving ? ` (${esc(k.open_bron_omschrijving)})` : ""}. Nog door niemand bevestigd.</div>`
      : k.open_prijs_cent ? `${v === "wacht" ? "" : `<span class="badge wacht">Nieuwe prijs wacht op bevestiging</span>`}
        <div class="big-price"${v === "wacht" ? "" : ` style="margin-top:10px"`}>${euro(k.open_prijs_cent)}<span class="onbevestigd">?</span></div>
        <div class="muted">${glasTekst(k.open_merk, k.open_volume_cl, k.open_per25_cent)}</div>
        <div class="muted small">Gemeld ${wanneer(k.open_op)}, nog niet bevestigd</div>
        ${k.huidig_prijs_cent ? `<div class="vorige"><span class="muted small">Vorige bevestigde prijs</span>
          <div><b>${euro(k.huidig_prijs_cent)}</b> <span class="muted">${glasTekst(k.huidig_merk, k.huidig_volume_cl, k.per25_cent)}</span></div>
          <div class="muted small">Laatst gecontroleerd ${wanneer(k.laatst_gecontroleerd)}</div></div>` : ""}`
      : k.huidig_prijs_cent ? `<div class="koersregel" style="margin-top:0"><div class="big-price">${euro(k.huidig_prijs_cent)}</div>${koersDelta(k)}</div>
        <div class="muted">${glasTekst(k.huidig_merk, k.huidig_volume_cl, k.per25_cent)}</div>
        <div class="muted small">Laatst gecontroleerd ${wanneer(k.laatst_gecontroleerd)}</div>
        ${positieHtml(k)}`
      : `<div class="big-price muted">€ ?</div><div class="muted" style="margin-top:6px">Nog geen koers. Speel deze kroeg vrij met de prijs van een vaasje.</div>`}
      ${k.ontdekker ? `<div class="small" style="margin-top:8px">Ontdekt door <b>${esc(k.ontdekker)}</b> ${wanneer(k.ontdekt_op)}</div>` : ""}
      ${actie}
      ${ingelogd ? "" : `<div class="small muted" style="margin-top:8px">Doe mee via het tabblad Ik. Een e-mailadres is niet nodig.</div>`}
    </div>
    ${incheckHtml(k)}
    <div id="tijden"></div>
    ${aanbodBlok(k)}
    <h3>Koersverloop <span class="muted">per vaasje</span></h3>
    <div id="spark"></div>
    <h3>Geschiedenis</h3>
    <div id="stamgast"></div>
    <div id="tijdlijn"><div class="muted small">Laden…</div></div>
    <div id="sluiting"></div>`;
}

// ---------------------------------------------------------------------------
// Openingstijden en sluitingen (kroeg_info, meld_kroeg, beoordeel_kroegmelding). Geen punten.
// ---------------------------------------------------------------------------

const DAGEN = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];
const vandaagDag = () => DAGEN[(new Date().getDay() + 6) % 7];
const tijdenTekst = (lijst) => (lijst.length ? lijst.join(", ") : "Gesloten").replaceAll("00:00-24:00", "Hele dag").replaceAll("-", "–");

async function laadKroegInfo(id) {
  const { data, error } = await sb.from("kroeg_info").select("*").eq("kroeg_id", id).maybeSingle();
  // Bestaat het overzicht nog niet (migratie nog niet uitgevoerd), dan blijft de app gewoon werken
  if (state.selected !== id || error) return;
  state.info = data;
  const t = $("#tijden"), sl = $("#sluiting");
  if (t) t.innerHTML = tijdenBlok(data);
  if (sl) sl.innerHTML = sluitingBlok(data);
}

// Knoppen bij een open melding: de melder kan intrekken, anderen met e-mailadres oordelen
function meldingKnoppen(m) {
  const uid = state.sessie?.user?.id;
  if (!state.sessie) return "";
  if (m.door_id === uid) return `<button class="mini" data-melding="${m.id}" data-oordeel-melding="klopt_niet">Intrekken</button>`;
  if (anoniem()) return `<div class="small muted">Koppel je e-mailadres (tabblad Ik) om dit te bevestigen.</div>`;
  return `<button class="mini" data-melding="${m.id}" data-oordeel-melding="klopt">Klopt</button><button class="mini" data-melding="${m.id}" data-oordeel-melding="klopt_niet">Klopt niet</button>`;
}

function tijdenBlok(info) {
  const tijden = info?.openingstijden;
  const melding = (info?.open_meldingen ?? []).find((m) => m.soort === "openingstijden");
  const vandaag = vandaagDag();
  const bron = !tijden ? "" : melding
    ? `Aangepast door <b>${esc(melding.door ?? "Onbekend")}</b> ${wanneer(melding.op)}${melding.klopt_niet ? " · 1 keer klopt niet" : ""}`
    : info.openingstijden_bron === "spelers" ? `Door spelers bijgewerkt ${wanneer(info.openingstijden_op)}` : `Uit Google, ${wanneer(info.openingstijden_op)}`;
  return `<h3>Openingstijden</h3>
    ${tijden ? `<ul class="tijden">${DAGEN.map((d) => `<li class="${d === vandaag ? "vandaag" : ""}"><span>${d[0].toUpperCase() + d.slice(1)}</span><span>${tijdenTekst(tijden[d] ?? [])}</span></li>`).join("")}</ul>
      <div class="small muted">${bron}</div>
      ${melding ? `<div class="btns">${meldingKnoppen(melding)}</div>` : ""}`
    : `<div class="small muted">Nog geen openingstijden bekend.</div>`}
    ${melding ? "" : `<div class="btns"><button class="btn" data-tijdenform ${state.sessie ? "" : "disabled"}>${tijden ? "Tijden kloppen niet" : "Tijden invullen"}</button></div>`}`;
}

function sluitingBlok(info) {
  const melding = (info?.open_meldingen ?? []).find((m) => m.soort === "gesloten");
  if (melding) {
    return `<div class="card">
      <div><b>${esc(melding.door ?? "Iemand")}</b> meldt dat deze kroeg definitief gesloten is.</div>
      <div class="small muted">Gemeld ${wanneer(melding.op)}${melding.klopt_niet ? ", 1 keer klopt niet" : ""}. Na een bevestiging door een andere speler verdwijnt de kroeg van de kaart.</div>
      <div class="btns">${meldingKnoppen(melding)}</div></div>`;
  }
  return `<div class="btns"><button class="btn" data-sluiting ${state.sessie ? "" : "disabled"}>Definitief gesloten?</button></div>`;
}

function tijdenFormView() {
  const k = state.kroegen.find((x) => x.id === state.selected);
  const nu = state.info?.openingstijden ?? {};
  return `<button class="back" data-cancel>‹ Annuleer</button>
    <h2>Openingstijden</h2>
    <div class="muted small">${esc(k.naam)}</div>
    <form class="form" id="tijdenForm">
      ${DAGEN.map((d) => `<label for="t-${d}">${d[0].toUpperCase() + d.slice(1)}</label>
        <input id="t-${d}" name="${d}" value="${esc((nu[d] ?? []).join(", "))}" placeholder="Gesloten" inputmode="numeric" autocomplete="off">`).join("")}
      <p class="small muted">Schrijf tijden als 16:00-02:00. Twee keer open op een dag: 12:00-15:00, 17:00-01:00. Laat een dag leeg als de kroeg dan dicht is.</p>
      <div class="btns"><button class="btn primary" type="submit">Opslaan</button></div>
      <p class="small muted">Je wijziging geldt meteen. Andere spelers kunnen hem bevestigen of afkeuren. Dit levert geen punten op.</p>
    </form>`;
}

// "16.00 - 2.00, 17:00-01:00" wordt ["16:00-02:00", "17:00-01:00"]; null bij iets onleesbaars
function leesTijden(tekst) {
  const t = tekst.trim().toLowerCase();
  if (!t || t === "gesloten" || t === "dicht") return [];
  const uit = [];
  for (const deel of t.split(/[,;]|\ben\b/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*[-–]\s*(\d{1,2})(?:[:.](\d{2}))?$/.exec(deel);
    if (!m) return null;
    const [u1, m1, u2, m2] = [Number(m[1]), Number(m[2] ?? 0), Number(m[3]), Number(m[4] ?? 0)];
    if (u1 > 23 || u2 > 24 || m1 > 59 || m2 > 59 || (u2 === 24 && m2 > 0)) return null;
    const twee = (n) => String(n).padStart(2, "0");
    uit.push(`${twee(u1)}:${twee(m1)}-${twee(u2)}:${twee(m2)}`);
  }
  return uit.length <= 4 ? uit : null;
}

async function verstuurTijden(form) {
  const k = state.kroegen.find((x) => x.id === state.selected);
  const fd = new FormData(form);
  const tijden = {};
  for (const d of DAGEN) {
    const lijst = leesTijden(String(fd.get(d) ?? ""));
    if (!lijst) return toast(`Kan de tijden van ${d} niet lezen; schrijf bijvoorbeeld 16:00-02:00`);
    tijden[d] = lijst;
  }
  const knop = form.querySelector("button[type=submit]"); knop.disabled = true;
  const { error } = await sb.rpc("meld_kroeg", { p_kroeg_id: k.id, p_soort: "openingstijden", p_openingstijden: tijden });
  knop.disabled = false;
  if (error) return toast(error.message);
  state.tijdenForm = null;
  toast("Openingstijden bijgewerkt, bedankt");
  draw();
}

async function meldGesloten() {
  const k = state.kroegen.find((x) => x.id === state.selected);
  if (!confirm(`Is ${k.naam} definitief gesloten? Na een bevestiging door een andere speler verdwijnt de kroeg van de kaart.`)) return;
  const { error } = await sb.rpc("meld_kroeg", { p_kroeg_id: k.id, p_soort: "gesloten" });
  if (error) return toast(error.message);
  toast("Gemeld; een andere speler moet het bevestigen");
  draw();
}

async function beoordeelMelding(id, oordeel) {
  const { data, error } = await sb.rpc("beoordeel_kroegmelding", { p_melding_id: id, p_oordeel: oordeel });
  if (error) return toast(error.message);
  toast(data === "bevestigd" ? "Bevestigd, bedankt" : data === "weerlegd" ? "Weggehaald" : "Genoteerd; nog een keer klopt niet en het wordt teruggedraaid");
  // Een bevestigde sluiting haalt de kroeg van de kaart
  if (data === "bevestigd" && (state.info?.open_meldingen ?? []).some((m) => m.id === id && m.soort === "gesloten")) {
    await laadKroegen();
    return sluitKroeg();
  }
  draw();
}

// Inchecken: persoonlijk, los van de gezamenlijke mist. Alleen ter plaatse, een keer per dag.
function incheckHtml(k) {
  if (!state.sessie) return "";
  const m = state.mijn.get(k.id);
  const vandaag = m && isVandaag(m.laatst);
  const d = state.pos ? afstand(state.pos, [k.lon, k.lat]) : null;
  const tekst = m
    ? `Je was hier ${keer(m.keer)}, ${vandaag ? "vandaag nog" : `laatst ${wanneer(m.laatst)}`}.`
    : "Je bent hier nog niet ingecheckt. Check in om deze kroeg op jouw kaart te ontgrendelen.";
  const hint = vandaag ? "" : d != null && d > INCHECK_M ? `Je bent ${meters(d)} hiervandaan; inchecken kan binnen ${INCHECK_M} m.` : "";
  return `<div class="card incheck ${m ? "bezocht" : ""}">
    <span class="ic">${ICON_PIN}</span>
    <div><div class="t">Mijn kroegen</div><div>${tekst}</div>${hint ? `<div class="t">${hint}</div>` : ""}</div>
    ${vandaag ? "" : `<button class="btn primary" data-inchecken="${k.id}">Inchecken</button>`}
  </div>`;
}

// Extra bier bij een kroeg: geen punten, wel bevestigen ("klopt") of afkeuren ("klopt niet")
function aanbodBlok(k) {
  const lijst = aanbodVan(k.id).sort((a, b) => a.volgorde - b.volgorde || (a.prijs_cent ?? 1e9) - (b.prijs_cent ?? 1e9));
  const uid = state.sessie?.user?.id;
  const item = (a) => {
    const eigen = a.door_id === uid;
    const wat = [a.merk && a.merk !== a.soort_naam ? a.merk : null, a.volume_cl ? `${a.volume_cl} cl` : null].filter(Boolean).join(" · ");
    const knoppen = !state.sessie ? ""
      : eigen ? `<button class="mini" data-aanbod="${a.id}" data-oordeel-aanbod="klopt_niet">Intrekken</button>`
      : anoniem() ? ""
      : `<button class="mini" data-aanbod="${a.id}" data-oordeel-aanbod="klopt">Klopt</button><button class="mini" data-aanbod="${a.id}" data-oordeel-aanbod="klopt_niet">Klopt niet</button>`;
    return `<li class="aanbod">
      <div class="aanbod-main"><b>${esc(a.soort_naam)}</b>${wat ? ` <span class="muted">${esc(wat)}</span>` : ""}
        <div class="small muted">${esc(a.door ?? "Onbekend")}, ${wanneer(a.gecontroleerd_op ?? a.op)}${a.klopt_niet ? " · 1 keer klopt niet" : ""}</div></div>
      ${a.prijs_cent ? `<span class="price">${euro(a.prijs_cent)}</span>` : `<span class="small muted">prijs?</span>`}
      <div class="aanbod-knoppen">${knoppen}</div>
    </li>`;
  };
  return `<h3>Ook op de tap</h3>
    ${lijst.length ? `<ul class="aanbod-lijst">${lijst.map(item).join("")}</ul>` : `<div class="small muted">Nog niets gemeld naast de pils.</div>`}
    <div class="btns"><button class="btn" data-aanbodform ${state.sessie ? "" : "disabled"}>Bier toevoegen</button></div>
    <p class="small muted">Extra bier telt niet mee voor het spel en levert geen punten op, maar helpt anderen een kroeg te vinden.</p>`;
}

function aanbodFormView() {
  const k = state.kroegen.find((x) => x.id === state.selected);
  const f = state.aanbodForm;
  return `<button class="back" data-cancel>‹ Annuleer</button>
    <h2>Bier toevoegen</h2>
    <div class="muted small">${esc(k.naam)}</div>
    <form class="form" id="aanbodForm">
      <label>Soort</label>
      <select name="soort" required>${state.biersoorten.map((b) => `<option value="${b.code}" ${b.code === f.soort ? "selected" : ""}>${esc(b.naam)}</option>`).join("")}</select>
      <label>Merk (optioneel)</label>
      <input name="merk" maxlength="40" placeholder="Bijvoorbeeld Hertog Jan of La Chouffe">
      <label>Glas in cl (optioneel)</label>
      <input name="cl" inputmode="numeric" placeholder="Bijvoorbeeld 33, of 50 voor een pint">
      <label>Prijs in euro (optioneel)</label>
      <input name="prijs" inputmode="decimal" placeholder="5,50">
      <div class="btns"><button class="btn primary" type="submit">Toevoegen</button></div>
      <p class="small muted">Weet je de prijs niet, voeg het bier dan toch toe: dan kunnen anderen op deze soort zoeken.</p>
    </form>`;
}

async function verstuurAanbod(form) {
  const k = state.kroegen.find((x) => x.id === state.selected);
  const fd = new FormData(form);
  const merk = String(fd.get("merk") ?? "").trim();
  const clTekst = String(fd.get("cl") ?? "").trim();
  const prijsTekst = String(fd.get("prijs") ?? "").trim();
  const cl = clTekst ? Math.round(Number(clTekst.replace(",", "."))) : null;
  const prijs = prijsTekst ? Math.round(parseFloat(prijsTekst.replace(",", ".")) * 100) : null;
  if (merk && merk.length < 2) return toast("Vul een merk van minstens 2 tekens in, of laat het leeg");
  if (cl != null && (!Number.isFinite(cl) || cl < 15 || cl > 100)) return toast("Vul een glas tussen 15 en 100 cl in");
  if (prijs != null && (!Number.isFinite(prijs) || prijs < 50 || prijs > 2500)) return toast("Vul een prijs tussen €0,50 en €25 in");
  if (prijs != null && cl == null) return toast("Vul bij een prijs ook het glas in");
  const knop = form.querySelector("button[type=submit]"); knop.disabled = true;
  const { error } = await sb.rpc("meld_aanbod", { p_kroeg_id: k.id, p_soort: String(fd.get("soort")), p_merk: merk || null, p_volume_cl: cl, p_prijs_cent: prijs });
  knop.disabled = false;
  if (error) return toast(error.message);
  state.aanbodForm = null;
  toast("Toegevoegd, bedankt");
  await laadAanbod();
  draw();
}

async function beoordeelAanbod(id, oordeel) {
  const { data, error } = await sb.rpc("beoordeel_aanbod", { p_aanbod_id: id, p_oordeel: oordeel });
  if (error) return toast(error.message);
  toast(data === "weg" ? "Weggehaald" : oordeel === "klopt" ? "Bedankt voor het controleren" : "Genoteerd; nog een keer klopt niet en het verdwijnt");
  await laadAanbod();
  draw();
}

async function laadAanbod() {
  const [{ data: aanbod, error }, soorten] = await Promise.all([
    sb.from("aanbod_overzicht").select("*").eq("gemeente", STAD.naam),
    state.biersoorten.length ? { data: state.biersoorten } : sb.from("biersoorten").select("*").order("volgorde"),
  ]);
  // Bestaat de tabel nog niet (migratie nog niet uitgevoerd), dan blijft de app gewoon werken zonder extra's
  if (error) return;
  state.aanbod = aanbod ?? [];
  state.biersoorten = soorten.data ?? [];
  kaartBijwerken();
}

async function laadTijdlijn(id) {
  const uid = state.sessie?.user?.id;
  let bijdragersQuery = sb.from("kroeg_bijdragers").select("gebruiker_id,naam,bijdragen,plek").eq("kroeg_id", id);
  bijdragersQuery = uid ? bijdragersQuery.or(`plek.eq.1,gebruiker_id.eq.${uid}`) : bijdragersQuery.eq("plek", 1);
  const [{ data, error }, { data: bijdragers, error: bijdragersFout }] = await Promise.all([
    sb.from("kroeg_tijdlijn").select("*").eq("kroeg_id", id).order("op", { ascending: false }).limit(60),
    bijdragersQuery,
  ]);
  if (state.selected !== id) return;
  if (error) { $("#tijdlijn").innerHTML = `<div class="muted small">Laden mislukt.</div>`; return; }
  $("#stamgast").innerHTML = data.length && !bijdragersFout ? stamgastHtml(bijdragers ?? [], uid) : "";
  const open = data.find((g) => g.status === "wacht");
  const el = $("#openMelding");
  if (el && open) {
    const eigen = open.door_id === uid;
    const al = state.profiel && [...open.bevestigd_door, ...open.weerlegd_door].includes(state.profiel.naam);
    el.innerHTML = `<div><b>${esc(open.door)}</b> meldt ${euro(open.prijs_cent)} voor ${esc(open.merk)} ${open.volume_cl} cl</div>
      <div class="muted small">${wanneer(open.op)}${open.ter_plaatse ? " · ter plaatse" : ""}${open.uitschieter ? " · wijkt sterk af, twee bevestigingen nodig" : ""}</div>
      ${open.foto_pad ? `<div class="small"><a href="${fotoUrl(open.foto_pad)}" target="_blank" rel="noopener">Foto van de prijslijst</a></div>` : ""}
      ${eigen ? `<div class="small muted" style="margin-top:8px">Wacht op bevestiging door andere spelers.</div>`
        : al ? `<div class="small muted" style="margin-top:8px">Je hebt deze melding al beoordeeld.</div>`
        : anoniem() ? `<div class="small muted" style="margin-top:8px">Koppel je e-mailadres (tabblad Ik) om meldingen van anderen te bevestigen of te weerleggen.</div>`
        : `<div class="btns"><button class="btn good" data-oordeel="klopt" data-g="${open.id}" ${state.sessie ? "" : "disabled"}>Klopt</button>
             <button class="btn bad" data-oordeel="klopt_niet" data-g="${open.id}" ${state.sessie ? "" : "disabled"}>Klopt niet</button></div>`}`;
  }
  $("#tijdlijn").innerHTML = data.length ? `<ul class="timeline">${data.map(tijdlijnItem).join("")}</ul>` : `<div class="muted small">Nog niets gebeurd.</div>`;
  $("#spark").innerHTML = spark(data);
}

// Stamgast: wie hier het vaakst de prijs heeft bijgewerkt of bevestigd (zie view kroeg_stamgast).
function stamgastHtml(bijdragers, uid) {
  const eerste = bijdragers.find((b) => b.plek === 1);
  const stam = eerste && eerste.bijdragen >= STAMGAST_MIN ? eerste : null;
  const mijn = uid ? bijdragers.find((b) => b.gebruiker_id === uid)?.bijdragen ?? 0 : 0;
  const bijdr = (n) => (n === 1 ? "1 bijdrage" : `${n} bijdragen`);
  let sub = "";
  if (stam && stam.gebruiker_id === uid) sub = "Dit is jouw stamkroeg. Blijf de prijs bijhouden om dat zo te houden.";
  else if (stam && uid) sub = `Jij: ${keer(mijn)}. Nog <b>${bijdr(stam.bijdragen - mijn + 1)}</b> om stamgast te worden.`;
  else if (!stam && uid) sub = `Nog <b>${bijdr(Math.max(1, STAMGAST_MIN - mijn))}</b> en jouw naam staat hier.`;
  else if (!stam) sub = `Wie hier minstens ${STAMGAST_MIN} keer de prijs bijwerkt of bevestigt, wordt stamgast.`;
  return `<div class="card stamgast ${stam ? "" : "vrij"}">
    <span class="ic">${ICON_GLAS}</span>
    <div>${stam
      ? `<div class="t">Stamgast</div><b>${esc(stam.naam)}</b><div class="t">${keer(stam.bijdragen)} bijgewerkt of bevestigd</div>`
      : `<div class="t">Stamgast</div><b>Nog niemand</b>`}</div>
    ${sub ? `<div class="sub">${sub}</div>` : ""}
  </div>`;
}

function tijdlijnItem(g) {
  if (g.bron === "menukaart") {
    const st = g.status === "wacht" ? " (nog door niemand bevestigd)" : g.status === "bevestigd" ? " (klopte nog)" : " (achterhaald)";
    return `<li class="menukaart"><div class="t-what">Menukaart: ${euro(g.prijs_cent)}${st}</div>
      <div class="t-meta">${datumTekst(g.op)} · ${esc(g.bron_omschrijving ?? "menukaart")} · ${esc(g.merk)} ${g.volume_cl} cl</div></li>`;
  }
  const wat = g.soort === "eerst" ? `Eerst gemeld: ${euro(g.prijs_cent)}`
    : g.soort === "wijziging" ? `Gewijzigd: ${euro(g.vorige_prijs_cent)} → ${euro(g.prijs_cent)}`
    : `Gecontroleerd: klopt nog`;
  const status = g.status === "wacht" ? " (wacht op bevestiging)" : g.status === "weerlegd" ? " (weerlegd)" : "";
  const meta = [`${wanneer(g.op)} door ${esc(g.door ?? "onbekend")}`];
  if (g.soort !== "check") meta.push(`${esc(g.merk)} ${g.volume_cl} cl`);
  if (g.bevestigd_door.length) meta.push(`bevestigd door ${g.bevestigd_door.map(esc).join(", ")}`);
  if (g.weerlegd_door.length) meta.push(`weerlegd door ${g.weerlegd_door.map(esc).join(", ")}`);
  if (g.ter_plaatse) meta.push("ter plaatse");
  return `<li class="${g.soort === "check" ? "check" : g.status}"><div class="t-what">${wat}${status}</div>
    <div class="t-meta">${meta.join(" · ")}</div>
    ${g.foto_pad ? `<div class="t-meta"><a href="${fotoUrl(g.foto_pad)}" target="_blank" rel="noopener">Foto</a></div>` : ""}</li>`;
}

// Koersgrafiek: trapjes per prijs, met een vlak eronder en de Pilsindex als stippellijn.
// pts: [{ t, v }] oplopend in tijd; het laatste punt is nu.
function grafiekSvg(pts, { id = "g", lijn = null, kleur = "var(--accent)", tekst = "var(--fg)", as = "var(--muted)", lijnLabel = "index" } = {}) {
  const W = 320, H = 96, R = 56, nu = Date.now(), van = pts[0].t;
  const vals = pts.map((p) => p.v).concat(lijn ? lijn.map((p) => p.v) : []);
  const lo = Math.min(...vals) * 0.95, hi = Math.max(...vals) * 1.05;
  const X = (t) => 2 + ((Math.max(t, van) - van) / (nu - van || 1)) * (W - R);
  const Y = (v) => 6 + (H - 26) * (1 - (v - lo) / (hi - lo || 1));
  let d = `M${X(pts[0].t)},${Y(pts[0].v)}`;
  for (let i = 1; i < pts.length; i++) d += ` H${X(pts[i].t)} V${Y(pts[i].v)}`;
  d += ` H${X(nu)}`;
  const vlak = `${d} V${H - 20} H${X(pts[0].t)} Z`;
  const laatst = pts[pts.length - 1].v;
  const maand = (t) => new Date(t).toLocaleDateString("nl-NL", { month: "short", year: "2-digit" }).replace(".", "");
  const lijnPad = lijn?.length > 1 ? lijn.map((p, i) => `${i ? "L" : "M"}${X(p.t)},${Y(p.v)}`).join(" ") : "";
  return `<svg class="grafiek" viewBox="0 0 ${W} ${H}" role="img" aria-label="Koersverloop, nu ${euro(laatst)}">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${kleur}" stop-opacity=".38"/><stop offset="1" stop-color="${kleur}" stop-opacity="0"/></linearGradient></defs>
    <line x1="2" x2="${W - R}" y1="${H - 20}" y2="${H - 20}" stroke="${as}" stroke-opacity=".4"/>
    <path d="${vlak}" fill="url(#${id})"/>
    ${lijnPad ? `<path d="${lijnPad}" fill="none" stroke="${as}" stroke-width="1.2" stroke-dasharray="3 3"/>${lijnLabel ? `<text x="4" y="${Y(lijn[0].v) - 4}" font-size="9.5" fill="${as}">${lijnLabel}</text>` : ""}` : ""}
    <path d="${d}" fill="none" stroke="${kleur}" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="${X(nu)}" cy="${Y(laatst)}" r="3.5" fill="${kleur}"/>
    <text x="${W - R + 8}" y="${Y(laatst) + 4}" font-size="12" font-weight="700" fill="${tekst}">${euro(laatst)}</text>
    <text x="2" y="${H - 6}" font-size="9.5" fill="${as}">${maand(van)}</text>
    <text x="${W - R}" y="${H - 6}" font-size="9.5" fill="${as}" text-anchor="end">nu</text>
  </svg>`;
}

function spark(events) {
  // Prijzen veranderen zelden; laat daarom de hele bekende geschiedenis zien (minstens een jaar, hooguit vijf)
  const oudste = events.length ? new Date(events[events.length - 1].op).getTime() : Date.now();
  const van = Math.max(Date.now() - 5 * 365 * DAG, Math.min(Date.now() - 365 * DAG, oudste));
  // Bevestigde prijzen, plus prijzen van menukaarten: die laten zien wat het op die datum kostte
  const alle = events.filter((g) => (g.status === "bevestigd" || g.bron === "menukaart") && g.soort !== "check")
    .map((g) => ({ t: new Date(g.op).getTime(), v: (g.prijs_cent * 25) / g.volume_cl })).reverse();
  const binnen = alle.filter((p) => p.t > van);
  const voor = alle.filter((p) => p.t <= van).pop();
  const pts = [...(voor ? [{ t: van, v: voor.v }] : []), ...binnen];
  if (!pts.length) return `<div class="muted small">Nog geen koers.</div>`;
  pts.push({ t: Date.now(), v: pts[pts.length - 1].v });
  const lijn = (state.koers.index?.reeks ?? []).filter((p) => p.t >= pts[0].t);
  return grafiekSvg(pts, { id: "gk", lijn, lijnLabel: `index ${state.koers.index ? euro(state.koers.index.nu) : ""}` });
}

// Waar staat deze kroeg in de stad? Verschil met de Pilsindex, plek en jaarbereik.
function positieHtml(k) {
  const c = koersVan(k.id), idx = state.koers.index;
  if (!c || !idx) return "";
  const alle = [...state.koers.punten.keys()].map((id) => koersVan(id).nu);
  const lo = Math.min(...alle), hi = Math.max(...alle);
  const pos = (v) => (hi > lo ? ((v - lo) / (hi - lo)) * 100 : 50);
  const verschil = c.nu - idx.nu;
  const plek = alle.filter((v) => v < c.nu).length + 1;
  const tekst = verschil === 0 ? "Precies op de Pilsindex" : `${euro(Math.abs(verschil))} ${verschil < 0 ? "onder" : "boven"} de Pilsindex`;
  return `<div class="positie">
    <div class="t"><b>${tekst}</b><span class="muted">${plek === 1 ? "goedkoopste" : `${plek}e goedkoopste`} van ${alle.length}</span></div>
    ${hi > lo ? `<div class="schaal" role="img" aria-label="${euro(c.nu)} op een schaal van ${euro(lo)} tot ${euro(hi)}, index ${euro(idx.nu)}">
      <span class="idx" style="left:${pos(idx.nu)}%"></span><span class="hier" style="left:${pos(c.nu)}%"></span></div>
    <div class="schaal-as"><span>${euro(lo)}</span><span>index ${euro(idx.nu)}</span><span>${euro(hi)}</span></div>` : ""}
    <div class="kv"><div>Vast sinds<b>${maandJaar(c.vastSinds)}</b></div><div>Vorige prijs<b>${c.vorig != null ? euro(c.vorig) : "onbekend"}</b></div>
      <div>Per jaar<b>${c.perJaar == null ? "te kort" : c.perJaar === 0 ? "gelijk" : `${c.perJaar > 0 ? "+" : "−"}${procent(c.perJaar)}`}</b></div></div>
  </div>`;
}

// Naast de grote prijs: de stap van het afgelopen jaar, of hoe lang de prijs al gelijk is
function koersDelta(k) {
  const c = koersVan(k.id);
  if (!c) return "";
  if (c.recent) return `<div style="text-align:right">${deltaHtml(c.delta, { pil: true })}
    <div class="small muted" style="margin-top:4px">${c.delta > 0 ? "+" : "−"}${procent(c.pct)} in ${maandJaar(c.vastSinds)}</div></div>`;
  const maanden = Math.floor((Date.now() - c.vastSinds) / (30.4 * DAG));
  return maanden >= 2 ? `<div style="text-align:right"><span class="delta pil gelijk">→ vast</span>
    <div class="small muted" style="margin-top:4px">al ${maanden >= 24 ? `${Math.floor(maanden / 12)} jaar` : `${maanden} maanden`}</div></div>` : "";
}

function formView() {
  const k = state.kroegen.find((x) => x.id === state.selected);
  const f = state.form;
  return `<button class="back" data-cancel>‹ Annuleer</button>
    <h2>${k.versheid === "locked" ? "Speel vrij" : "Nieuwe prijs"}</h2>
    <div class="muted small">${esc(k.naam)}</div>
    <p class="small muted">Het spel vergelijkt de goedkoopste pils van de tap in een vaasje. Schenkt deze kroeg geen vaasje, kies dan het kleinste glas; we rekenen om naar een vaasje. Ander bier voeg je toe onder "Ook op de tap".</p>
    <form class="form" id="prijsForm">
      <label>Merk pils</label>
      <select name="merk">${MERKEN.map((m) => `<option ${m === f.merk ? "selected" : ""}>${m}</option>`).join("")}<option value="_anders" ${MERKEN.includes(f.merk) ? "" : "selected"}>Anders…</option></select>
      <input name="merkAnders" placeholder="Ander merk" style="margin-top:6px;${MERKEN.includes(f.merk) ? "display:none" : ""}" value="${MERKEN.includes(f.merk) ? "" : esc(f.merk)}">
      <label>Glas</label>
      <div class="seg">${GLAZEN.map((g) => `<button type="button" data-cl="${g.cl}" aria-pressed="${g.cl === f.cl}">${g.naam}<br><span class="small muted">${g.cl} cl</span></button>`).join("")}</div>
      <label>Prijs in euro</label>
      <input name="prijs" inputmode="decimal" placeholder="3,50" required value="${esc(f.prijs ?? "")}">
      <label>Foto van de prijslijst (optioneel, +5)</label>
      <input name="foto" type="file" accept="image/*" capture="environment">
      <label class="check"><input type="checkbox" name="locatie" ${f.locatie ? "checked" : ""}> Mijn locatie meesturen (ter plaatse: x1,5 punten)</label>
      <div class="btns"><button class="btn primary" type="submit" id="verstuur">Versturen</button></div>
      <p class="small muted">Punten krijg je zodra een andere speler je melding bevestigt.</p>
    </form>`;
}

async function beursView() {
  const [{ data: wijken }, { data: recent }] = await Promise.all([
    sb.from("wijk_voortgang").select("*").eq("gemeente", STAD.naam).order("naam"),
    sb.from("kroeg_tijdlijn").select("id,kroeg_id,kroeg,soort,status,door,op,prijs_cent,vorige_prijs_cent,volume_cl").order("op", { ascending: false }).limit(15),
  ]);
  if (state.tab !== "beurs" || state.selected != null) return;
  const s = state.stad ?? { kroegen: 0, vrijgespeeld: 0, vers: 0, oud: 0, bijdragen_week: 0, spelers_week: 0 };
  const pct = s.kroegen ? Math.round((s.vrijgespeeld / s.kroegen) * 100) : 0;
  const MS = [25, 50, 75, 100], next = MS.find((m) => m > pct), nodig = next ? Math.ceil((next / 100) * s.kroegen) - s.vrijgespeeld : 0;
  const C = 2 * Math.PI * 42;
  const versPct = s.vrijgespeeld ? Math.round((s.vers / s.vrijgespeeld) * 100) : 0;
  const idx = state.koers.index;

  // Bierprijzen dalen bijna nooit en stijgen hooguit een keer per jaar. Daarom geen stijgers en dalers,
  // maar wie dit jaar verhoogde en wie het langst prijsvast is. Goedkoper worden is zeldzaam en krijgt een eigen plek.
  const jaar = bewegers();
  const verhoogd = jaar.filter((x) => x.c.delta > 0).slice(0, 3);
  const goedkoper = jaar.filter((x) => x.c.delta < 0);
  const vast = prijsvast().slice(0, 3);
  const metKoers = state.kroegen.map((k) => ({ k, c: koersVan(k.id) })).filter((x) => x.c).sort((a, b) => a.c.nu - b.c.nu);
  const mover = ({ k, c }, onder, rechts = "") => `<button class="mover" data-kroeg="${k.id}">
      <span class="n">${esc(k.naam)}</span><span class="p">${euro(c.nu)}</span>
      <span class="w">${codeVan(k.id)}${onder ? ` · ${onder}` : ""}</span>${rechts}</button>`;
  const kolom = (kop, soort, rijen, leeg) => `<div class="card"><div class="kop ${soort}">${kop}</div>
      ${rijen.length ? rijen.join("") : `<div class="small muted" style="padding:8px 0">${leeg}</div>`}</div>`;
  const duo = metKoers.length
    ? `<h3>Prijsbewegingen <span class="muted">12 maanden</span></h3>
      <div class="duo">${kolom("→ Langst vast", "gelijk", vast.map((x) => mover(x, `sinds ${maandJaar(x.c.vastSinds)}`)), "")}${kolom("↗ Verhoogd", "op", verhoogd.map((x) => mover(x, maandKort(x.c.vastSinds), deltaHtml(x.c.delta))), "Dit jaar nog niemand")}</div>
      ${goedkoper.length ? `<div class="card goedkoper"><div class="kop af">↘ Goedkoper geworden</div><div class="small muted">Dat gebeurt bijna nooit. Proost op deze kroegen.</div>
        ${goedkoper.map((x) => mover(x, maandKort(x.c.vastSinds), deltaHtml(x.c.delta))).join("")}</div>` : ""}`
    : "";

  // Wijken als sectoren: de mediaan per wijk naast de Pilsindex
  const sector = (w) => {
    const m = mediaan(state.kroegen.filter((k) => k.wijk === w.naam).map((k) => koersVan(k.id)?.nu).filter(Boolean));
    return `<div class="sector">
      <div class="t"><b>${esc(w.naam)}</b><span>${m ? `<span class="price">${euro(m)}</span>` : `<span class="small muted">geen koers</span>`}</span></div>
      <div class="t small muted"><span>${w.vrijgespeeld} van ${w.kroegen} vrijgespeeld</span><span>${m && idx ? deltaHtml(m - idx.nu) + " t.o.v. index" : ""}</span></div>
      <div class="bar"><span style="width:${(w.vrijgespeeld / w.kroegen) * 100}%"></span></div></div>`;
  };

  const melding = (g) => {
    const per25 = g.volume_cl ? Math.round((g.prijs_cent * 25) / g.volume_cl) : null;
    const verschil = g.soort === "wijziging" && g.vorige_prijs_cent != null ? g.prijs_cent - g.vorige_prijs_cent : null;
    return `<li><button class="row" data-kroeg="${g.kroeg_id}">
      <span class="row-main"><span class="row-title">${codeHtml(g.kroeg_id)}${esc(g.door ?? "Iemand")} ${g.soort === "eerst" ? "speelde" : g.soort === "wijziging" ? "wijzigde" : "controleerde"} ${esc(g.kroeg)}${g.soort === "eerst" ? " vrij" : ""}</span>
      <span class="row-sub">${wanneer(g.op)}${g.status === "wacht" ? " · wacht op bevestiging" : g.status === "weerlegd" ? " · weerlegd" : ""}</span></span>
      ${g.soort !== "check" && per25 ? `<span class="price">${euro(g.prijs_cent)}${verschil ? `<small class="delta ${richting(verschil)}">${KOERS_TAAL[richting(verschil)]} ${bedrag(verschil)}</small>` : `<small>${g.volume_cl} cl</small>`}</span>` : ""}</button></li>`;
  };

  body.innerHTML = `
    <div class="indexkaart">
      <div class="kop">Pilsindex ${esc(STAD.naam)}<span>${idx ? `${idx.n} ${idx.n === 1 ? "kroeg" : "kroegen"}` : ""}</span></div>
      ${idx ? `<div class="stand"><span class="big-price">${euro(idx.nu)}</span>${idx.delta != null ? `${deltaHtml(idx.delta, { pct: idx.pct, pil: true })}<span class="uitleg">in 12 maanden</span>` : ""}</div>
        <div class="uitleg">Wat een vaasje pils in ${esc(STAD.naam)} kost: de middelste van de laatst bekende prijzen. Bierprijzen gaan meestal een keer per jaar omhoog, daarom vergelijken we met een jaar terug.</div>
        ${idx.reeks.length > 1 ? `<div class="grafiek">${grafiekSvg(idx.reeks, { id: "gi", tekst: "var(--krant-fg)", as: "var(--krant-muted)", lijnLabel: "" })}</div>` : ""}`
      : `<div class="stand"><span class="big-price">€ ?</span></div>
        <div class="uitleg">Nog geen koers. Speel de eerste kroeg vrij en zet de Pilsindex op het bord.</div>`}
    </div>
    <div class="small muted">↗ duurder · ↘ goedkoper · → vast. Rood en groen zoals jij het als klant voelt.</div>
    ${duo}
    <h3>Samen vrijspelen <span class="muted">${s.vrijgespeeld}/${s.kroegen}</span></h3>
    <div class="card ring-big">
      <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" class="ring-bg"/><circle cx="50" cy="50" r="42" class="ring-fg" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - pct / 100)}"/></svg>
      <div><div class="pct">${pct}%</div><div>${STAD.naam} samen vrijgespeeld</div>
      <div class="small muted">${s.vrijgespeeld} van ${s.kroegen} kroegen${next ? ` · nog ${nodig} tot ${next}%` : " · alles vrijgespeeld!"}</div></div>
    </div>
    <div class="milestones">${MS.map((m) => `<span class="${pct >= m ? "done" : ""}">${m}%</span>`).join("")}</div>
    <h3>Deze week, met z'n allen</h3>
    <div class="card">
      <div><b class="num">${s.bijdragen_week}</b> van ${WEEKDOEL} bijdragen <span class="muted small">· ${s.spelers_week} spelers</span></div>
      <div class="bar"><span style="width:${Math.min(100, (s.bijdragen_week / WEEKDOEL) * 100)}%"></span></div>
      <div style="margin-top:12px"><b class="num">${s.oud}</b> oude koersen (90+ dagen) om te controleren <span class="muted small">· +15 per controle</span></div>
      <div style="margin-top:12px"><b class="num">${versPct}%</b> van de koersen is vers</div>
      <div class="bar fresh"><span style="width:${versPct}%"></span></div>
    </div>
    <h3>Sectoren <span class="muted">per wijk</span></h3>
    ${(wijken ?? []).length ? `<div class="card" style="padding:4px 14px">${(wijken ?? []).map(sector).join("")}</div>` : `<div class="muted small">Nog geen wijken geladen.</div>`}
    <h3>Laatste meldingen</h3>
    ${(recent ?? []).length ? `<ul class="list">${recent.map(melding).join("")}</ul>` : `<div class="muted small">Nog geen activiteit.</div>`}`;
}

async function rangView() {
  const kolom = state.periode;
  const { data } = await sb.from("ranglijst").select("*").gt(kolom, 0).order(kolom, { ascending: false }).limit(50);
  if (state.tab !== "rang" || state.selected != null) return;
  const uid = state.sessie?.user?.id;
  const P = [["week", "Week"], ["maand", "Maand"], ["altijd", "Altijd"]];
  body.innerHTML = `<h2>Koersmakers</h2><p class="muted small" style="margin-top:0">Wie de koers van ${esc(STAD.naam)} het best bijhoudt. Punten voor melden en controleren, nooit voor drinken.</p>
    <div class="chips">${P.map(([id, n]) => `<button class="chip" data-periode="${id}" aria-pressed="${id === kolom}">${n}</button>`).join("")}</div>
    ${(data ?? []).length ? `<ul class="list">${data.map((r, i) => `<li class="row ${r.id === uid ? "me" : ""}">
      <span class="rank">${i + 1}</span>
      <span class="row-main"><span class="row-title">${esc(r.naam)}</span><span class="row-sub">${r.ontdekt} ontdekt · betrouwbaarheid ${Math.round(r.betrouwbaarheid)}%</span></span>
      <span class="price">${r[kolom]}<small>punten</small></span></li>`).join("")}</ul>` : `<div class="empty">Nog niemand heeft punten in deze periode.</div>`}`;
}

const LOGO = {
  apple: `<svg class="logo" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.37 12.6c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.47.83-.72 0-1.82-.81-3-.79-1.54.02-2.96.9-3.76 2.28-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74 1.38 0 1.77.74 2.98.72 1.23-.02 2.01-1.12 2.76-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.4-.92-2.42-3.66zM14.1 5.86c.63-.77 1.06-1.83.94-2.89-.91.04-2.01.61-2.66 1.37-.58.67-1.09 1.75-.96 2.79 1.02.08 2.05-.52 2.68-1.27z"/></svg>`,
  google: `<svg class="logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.27c0-.82-.07-1.6-.2-2.36H12v4.47h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.56-5.17 3.56-8.73z"/><path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.29 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.28a12 12 0 0 0 0 10.8l4.01-3.1z"/><path fill="#EA4335" d="M12 4.75c1.76 0 3.34.6 4.58 1.8l3.44-3.44A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.28 6.6l4.01 3.1C6.23 6.86 8.88 4.75 12 4.75z"/></svg>`,
  slot: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17 9V7A5 5 0 0 0 7 7v2a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM9 7a3 3 0 0 1 6 0v2H9z"/></svg>`,
};

// Knoppen voor Apple en Google. Zolang een aanbieder in Supabase uit staat, staat de knop op slot
// (zie docs/inloggen-met-apple-en-google.md). Een anonieme speler koppelt er zijn account mee.
function aanbiederKnoppen() {
  const werkwoord = anoniem() ? "Koppelen met" : "Doorgaan met";
  return `<div class="sociaal">${[["apple", "Apple"], ["google", "Google"]].map(([id, naam]) => state.aanbieders[id]
    ? `<button class="btn aanbieder" data-aanbieder="${id}">${LOGO[id]}<span class="naam">${werkwoord} ${naam}</span></button>`
    : `<button class="btn aanbieder op-slot" disabled aria-label="${werkwoord} ${naam}, nog niet beschikbaar">${LOGO[id]}<span class="naam">${werkwoord} ${naam}</span><span class="slot">${LOGO.slot}Binnenkort</span></button>`).join("")}</div>`;
}

async function inloggenMet(aanbieder, knop) {
  knop.disabled = true;
  const terug = location.origin + location.pathname;
  // De pagina gaat naar Apple of Google en komt terug met ?code=; supabase-js wisselt die zelf in
  const { error } = anoniem()
    ? await sb.auth.linkIdentity({ provider: aanbieder, options: { redirectTo: terug } })
    : await sb.auth.signInWithOAuth({ provider: aanbieder, options: { redirectTo: terug } });
  if (error) { knop.disabled = false; toast(vertaalAuthFout(error)); }
}

// Welke manieren van inloggen staan in Supabase aan? Openbare instellingen, zonder geheimen.
async function laadAanbieders() {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } });
    if (!r.ok) return;
    const { external } = await r.json();
    if (!external) return;
    state.aanbieders = { google: external.google === true, apple: external.apple === true, anoniem: external.anonymous_users === true };
  } catch { /* geen verbinding: alles blijft zoals het was */ }
}

// Speelt de speler zonder e-mailadres (anoniem account van Supabase)?
function anoniem() {
  return !!state.sessie?.user?.is_anonymous;
}

function codeFormulier(knop) {
  return `<p class="muted small">We hebben een code gemaild naar <strong>${esc(state.inlog.email)}</strong>. Typ hem hieronder in. Zie je niets, kijk dan ook bij spam.</p>
    <form class="form" id="codeForm">
      <label>Code uit de mail</label>
      <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" maxlength="10" required autofocus>
      <div class="btns"><button class="btn primary" type="submit">${knop}</button></div>
    </form>
    <div class="btns"><button class="btn" data-nieuwecode>Nieuwe code sturen</button><button class="btn" data-anderadres>Ander e-mailadres</button></div>`;
}

function ikView() {
  if (!state.sessie && state.inlog) {
    return `<h2>Vul je code in</h2>${codeFormulier("Inloggen")}`;
  }
  if (!state.sessie) {
    const vorig = onthouden.lees();
    const naamVeld = `<label>Spelersnaam</label><input name="naam" minlength="2" maxlength="24" placeholder="Zichtbaar op de ranglijst" value="${esc(vorig.naam ?? "")}" required>
        <label class="check"><input type="checkbox" name="leeftijd" required> Ik ben 18 jaar of ouder</label>`;
    // Staan anonieme accounts in Supabase (nog) uit, dan meld je je aan met e-mailadres en code
    const beginnen = state.aanbieders.anoniem
      ? `<p class="muted">Kies een spelersnaam en begin meteen. Geen e-mail of wachtwoord nodig.</p>
      <form class="form" id="startForm">${naamVeld}
        <div class="btns"><button class="btn primary" type="submit">Begin meteen</button></div>
      </form>`
      : `<p class="muted">Kies een spelersnaam en vul je e-mailadres in. Je krijgt een code per mail, geen wachtwoord nodig.</p>
      <form class="form" id="aanmeldForm">
        <label>E-mailadres</label><input name="email" type="email" autocomplete="email" required>${naamVeld}
        <div class="btns"><button class="btn primary" type="submit">Stuur code</button></div>
      </form>`;
    const inloggen = `${aanbiederKnoppen()}
      <div class="of">of met je e-mailadres</div>
      <form class="form" id="loginForm">
        <label>E-mailadres</label><input name="email" type="email" autocomplete="email" value="${esc(vorig.email ?? "")}" required>
        <div class="btns"><button class="btn ${vorig.email ? "primary" : ""}" type="submit">Stuur inlogcode</button></div>
      </form>`;
    // Heb je op dit apparaat al eens met e-mail ingelogd, dan eerst inloggen; een nieuw account met een
    // nieuwe naam is dan bijna nooit wat je wilt.
    if (vorig.email) {
      return `<h2>Welkom terug</h2><p class="muted">Log in met je account. Je naam en punten staan erin.</p>
      ${inloggen}
      <h3>Nieuw hier?</h3>${beginnen}
      <p class="small muted">We belonen bijdragen, nooit drinken.</p>`;
    }
    return `<h2>Doe mee</h2>${beginnen}
      <p class="small muted">We belonen bijdragen, nooit drinken.</p>
      <h3>Al een account?</h3>
      ${inloggen}`;
  }
  const p = state.profiel;
  const koppelen = !anoniem() ? "" : `<h3>Bewaar je account</h3>
    <div class="card">
      <div class="small">Je speelt zonder e-mailadres. Koppel er een om je punten te bewaren, op een ander toestel verder te spelen en prijzen van anderen te bevestigen.</div>
      ${state.inlog ? codeFormulier("Koppelen") : `<form class="form" id="koppelForm">
        <label>E-mailadres</label><input name="email" type="email" autocomplete="email" required>
        <div class="btns"><button class="btn primary" type="submit">Stuur code</button></div>
      </form>
      <div class="of">of</div>
      ${aanbiederKnoppen()}`}
    </div>`;
  return `<h2>${esc(p?.naam ?? "")}</h2>
    <div class="card saldo">
      <div class="kop">Puntensaldo</div>
      <div class="big-price">${(p?.altijd ?? 0).toLocaleString("nl-NL")}</div>
      <div class="kv">
        <div>Deze week<b class="${p?.week ? "plus" : ""}">${p?.week ? `↗ +${p.week}` : "0"}</b></div>
        <div>Deze maand<b class="${p?.maand ? "plus" : ""}">${p?.maand ? `+${p.maand}` : "0"}</b></div>
        <div>Betrouwbaar<b>${Math.round(p?.betrouwbaarheid ?? 50)}%</b></div>
      </div>
      <div class="small muted" style="margin-top:10px">${p?.ontdekt ?? 0} ${(p?.ontdekt ?? 0) === 1 ? "kroeg" : "kroegen"} ontdekt. Punten krijg je voor melden en controleren, nooit voor drinken.</div>
    </div>
    ${mijnKroegenHtml()}
    ${koppelen}
    ${p && !p.naam_vast ? `<form class="form" id="naamForm"><label>Kies je spelersnaam</label><input name="naam" minlength="2" maxlength="24" placeholder="Zichtbaar op de ranglijst" required>
      <div class="small muted">Je kiest je naam een keer; daarna staat hij vast.</div>
      <div class="btns"><button class="btn primary" type="submit">Naam opslaan</button></div></form>` : ""}
    ${p?.is_beheerder ? `<h3>Beheer</h3><div class="card"><div class="small muted">Haalt kroegen uit OpenStreetMap en wijken van het CBS voor ${STAD.naam}.</div>
      <div class="btns"><button class="btn primary" data-import>Kroegen en wijken importeren</button></div></div>` : ""}
    <div class="btns"><button class="btn bad" data-logout>Uitloggen</button></div>`;
}

// Mijn kroegen: persoonlijk overzicht van waar je hebt ingecheckt, los van het gezamenlijke spel.
function mijnKroegenHtml() {
  const alle = state.kroegen;
  const mijn = alle.filter((k) => state.mijn.has(k.id)).map((k) => ({ ...k, ...state.mijn.get(k.id) }));
  const pct = alle.length ? Math.round((mijn.length / alle.length) * 100) : 0;
  const kop = `<h2 style="margin-top:22px">Mijn kroegen</h2>
    <div class="muted small">Waar jij hebt ingecheckt. Alleen jij ziet dit.</div>`;
  if (!mijn.length) {
    return `${kop}<div class="card"><b>Nog nergens ingecheckt</b>
      <div class="muted small" style="margin-top:4px">Open een kroeg als je er bent en tik op Inchecken (binnen ${INCHECK_M} m). Een prijs melden of "Klopt nog" ter plaatse telt ook. Zo ontgrendel je de kroeg op jouw eigen kaart.</div>
      <div class="btns"><button class="btn" data-tocht-open="nieuw">Plan een tocht langs nieuwe kroegen</button></div></div>`;
  }

  // Wijken: hoeveel kroegen per wijk je hebt bezocht.
  const perWijk = new Map();
  for (const k of alle) {
    if (!k.wijk) continue;
    const w = perWijk.get(k.wijk) ?? { naam: k.wijk, kroegen: 0, bezocht: 0 };
    w.kroegen++; if (state.mijn.has(k.id)) w.bezocht++;
    perWijk.set(k.wijk, w);
  }
  const wijken = [...perWijk.values()].sort((a, b) => b.bezocht - a.bezocht || b.kroegen - a.kroegen);
  const wijkenBezocht = wijken.filter((w) => w.bezocht).length;

  const checkins = mijn.reduce((n, k) => n + k.keer, 0);
  const vaste = [...mijn].sort((a, b) => b.keer - a.keer || new Date(b.laatst) - new Date(a.laatst))[0];
  const metPrijs = mijn.filter((k) => k.per25_cent);
  const goedkoopst = [...metPrijs].sort((a, b) => a.per25_cent - b.per25_cent)[0];
  // Jouw index: de mediaan van de kroegen waar je was, naast de Pilsindex van de stad
  const eigenIndex = mediaan(mijn.map((k) => koersVan(k.id)?.nu).filter(Boolean));
  const pilsindex = state.koers.index?.nu;
  const eerste = mijn.reduce((a, k) => (!a || k.eerste < a ? k.eerste : a), null);
  const laatst = mijn.reduce((a, k) => (!a || k.laatst > a ? k.laatst : a), null);
  const sindsDagen = dagen(laatst);
  const nieuwInBuurt = state.pos
    ? alle.filter((k) => !state.mijn.has(k.id)).map((k) => ({ k, d: afstand(state.pos, [k.lon, k.lat]) })).sort((a, b) => a.d - b.d).slice(0, 3)
    : [];
  const initialen = (n) => n.replace(/^(de|het|'t|café|cafe|bar|eetcafé)\s+/i, "").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  return `${kop}
    <div class="tegels">
      <div class="tegel goud"><div class="getal">${mijn.length}</div><div>${mijn.length === 1 ? "kroeg" : "kroegen"}</div></div>
      <div class="tegel nacht"><div class="getal">${pct}%</div><div>van ${esc(STAD.naam)}</div></div>
    </div>
    <div class="btns"><button class="btn" data-mijn-kaart>Toon op mijn kaart</button></div>

    <h3>Wijken bezocht · ${wijkenBezocht} van ${wijken.length}</h3>
    ${wijken.length ? `<div class="card" style="padding:4px 14px">${wijken.map((w) => `<div class="wijkrij ${w.bezocht ? "" : "leeg"}">
      <div style="display:flex;justify-content:space-between"><span>${esc(w.naam)}</span><span class="small muted">${w.bezocht}/${w.kroegen}</span></div>
      <div class="bar"><span style="width:${(w.bezocht / w.kroegen) * 100}%"></span></div></div>`).join("")}</div>` : `<div class="muted small">Nog geen wijken geladen.</div>`}

    <h3>Verzamelde kroegen</h3>
    <div class="verzameld">${[...mijn].sort((a, b) => new Date(b.laatst) - new Date(a.laatst)).map((k) =>
      `<button class="munt" data-kroeg="${k.id}" title="${esc(k.naam)}" aria-label="${esc(k.naam)}, ${keer(k.keer)}">${esc(initialen(k.naam) || "?")}${k.keer > 1 ? `<span class="n">${k.keer}</span>` : ""}</button>`).join("")}</div>

    <h3>Alle stats</h3>
    <div class="statgrid">
      <div class="card stat"><b>${checkins}</b><span>check-ins</span></div>
      <div class="card stat"><b>${wijkenBezocht}</b><span>${wijkenBezocht === 1 ? "wijk" : "wijken"}</span></div>
      ${eigenIndex ? `<div class="card stat"><b>${euro(eigenIndex)}</b><span>jouw index${pilsindex ? `, ${deltaHtml(eigenIndex - pilsindex)} t.o.v. de stad` : ""}</span></div>` : ""}
      <div class="card stat"><b>${eerste ? new Date(eerste).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" }) : ""}</b><span>eerste check-in</span></div>
    </div>
    ${vaste && vaste.keer > 1 ? `<button class="row" data-kroeg="${vaste.id}"><span class="row-main"><span class="row-sub">Vaste stek</span><span class="row-title">${esc(vaste.naam)}</span></span><span class="price">${vaste.keer}<small>keer</small></span></button>` : ""}
    ${goedkoopst ? `<button class="row" data-kroeg="${goedkoopst.id}"><span class="row-main"><span class="row-sub">Goedkoopste waar je was</span><span class="row-title">${esc(goedkoopst.naam)}</span></span><span class="price">${spelPrijs(goedkoopst)}<small>per vaasje</small></span></button>` : ""}

    <h3>Volgende kroegentocht</h3>
    <div class="card nacht-kaart">
      <div>Laatste check-in ${sindsDagen === 0 ? "vandaag" : sindsDagen === 1 ? "gisteren" : `${sindsDagen} dagen geleden`}</div>
      <div class="small">Nog ${alle.length - mijn.length} kroegen in ${esc(STAD.naam)} waar je niet bent geweest.</div>
      <div class="btns"><button class="btn primary" data-tocht-open="nieuw">Plan een tocht langs nieuwe kroegen</button></div>
    </div>
    ${nieuwInBuurt.length ? `<div class="muted small" style="margin-top:4px">Dichtbij en nog niet bezocht</div>
      <ul class="list">${nieuwInBuurt.map(({ k, d }) => `<li><button class="row" data-kroeg="${k.id}"><span class="dot ${kroegVersheid(k)}"></span>
        <span class="row-main"><span class="row-title">${esc(k.naam)}</span><span class="row-sub">${meters(d)}${k.wijk ? ` · ${esc(k.wijk)}` : ""}</span></span>
        ${k.per25_cent ? `<span class="price">${spelPrijs(k)}<small>per vaasje</small></span>` : ""}</button></li>`).join("")}</ul>` : ""}
    <div class="btns"><button class="btn" data-wis-mijn>Mijn check-ins wissen</button></div>`;
}

// Kroegentocht: een route langs de goedkoopste kroegen of langs kroegen waar je nog niet was.
function planTocht(soort = state.tocht?.soort ?? "goedkoop", aantal = state.tocht?.aantal ?? 4) {
  if (soort === "nieuw" && !state.sessie) soort = "goedkoop";
  const start = state.pos ?? STAD.centrum;
  let kandidaten = state.kroegen.filter((k) => afstand(start, [k.lon, k.lat]) <= TOCHT_STRAAL_M);
  if (soort === "goedkoop") kandidaten = kandidaten.filter((k) => k.per25_cent).sort((a, b) => a.per25_cent - b.per25_cent).slice(0, aantal);
  else kandidaten = kandidaten.filter((k) => !state.mijn.has(k.id));
  // Volgorde: steeds de dichtstbijzijnde volgende kroeg (hemelsbreed).
  const stops = [];
  let hier = start;
  while (stops.length < aantal && kandidaten.length) {
    let best = 0;
    kandidaten.forEach((k, i) => { if (afstand(hier, [k.lon, k.lat]) < afstand(hier, [kandidaten[best].lon, kandidaten[best].lat])) best = i; });
    const k = kandidaten.splice(best, 1)[0];
    stops.push(k); hier = [k.lon, k.lat];
  }
  state.tocht = { soort, aantal, stops, start, vanaf: state.pos ? "jij" : "centrum" };
  kaartBijwerken();
}

function tochtView() {
  const t = state.tocht;
  const S = [["goedkoop", "Goedkoopst"], ...(state.sessie ? [["nieuw", "Nog niet bezocht"]] : [])];
  let vorige = t.start, totaal = 0;
  const rijen = t.stops.map((k, i) => {
    const d = afstand(vorige, [k.lon, k.lat]); totaal += d; vorige = [k.lon, k.lat];
    return `<li><button class="row" data-kroeg="${k.id}"><span class="nr">${i + 1}</span>
      <span class="row-main"><span class="row-title">${codeHtml(k.id)}${esc(k.naam)}</span><span class="row-sub">${meters(d)}${k.wijk ? ` · ${esc(k.wijk)}` : ""}${state.mijn.has(k.id) ? " · bezocht" : state.sessie ? " · nieuw voor jou" : ""}</span></span>
      ${k.per25_cent ? `<span class="price">${spelPrijs(k)}<small>per vaasje</small></span>` : ""}</button></li>`;
  }).join("");
  return `<button class="back" data-tocht-sluit>‹ Terug</button>
    <h2>Kroegentocht</h2>
    <div class="muted small">${t.vanaf === "jij" ? "Vanaf jouw locatie" : `Vanaf het centrum van ${esc(STAD.naam)}`}, kroegen binnen ${meters(TOCHT_STRAAL_M)}.
      ${t.vanaf === "jij" ? "" : `<button class="linkbtn" data-tocht-locatie>Gebruik mijn locatie</button>`}</div>
    <label class="veld">Langs</label>
    <div class="seg">${S.map(([id, n]) => `<button type="button" data-tocht-soort="${id}" aria-pressed="${id === t.soort}">${n}</button>`).join("")}</div>
    <label class="veld">Aantal kroegen</label>
    <div class="seg">${[3, 4, 5, 6].map((n) => `<button type="button" data-tocht-aantal="${n}" aria-pressed="${n === t.aantal}">${n}</button>`).join("")}</div>
    ${t.stops.length ? `<ul class="list" style="margin-top:12px">${rijen}</ul>
      <div class="small muted" style="margin-top:8px">Ongeveer ${meters(totaal)} lopen (hemelsbreed).</div>
      <div class="btns"><button class="btn primary" data-tocht-kaart>Toon op de kaart</button></div>`
    : `<div class="empty">${t.soort === "nieuw" ? "Je bent overal in de buurt al geweest. Knap!" : "Nog geen prijzen in de buurt."}</div>`}
    <p class="small muted">Check bij elke kroeg in om hem op jouw kaart te ontgrendelen. Geniet, maar drink met mate: inchecken kan ook met een fris.</p>`;
}

// ---------------------------------------------------------------------------
// Acties
// ---------------------------------------------------------------------------

function fotoUrl(pad) {
  return sb.storage.from("prijslijsten").getPublicUrl(pad).data.publicUrl;
}

function locatie(timeout = 8000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => { state.pos = [p.coords.longitude, p.coords.latitude]; resolve(state.pos); },
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 30000 });
  });
}

function openKroeg(id) {
  state.selected = Number(id);
  state.form = null; state.aanbodForm = null; state.tijdenForm = null; state.info = null;
  const k = state.kroegen.find((x) => x.id === state.selected);
  if (k) map.easeTo({ center: [k.lon, k.lat], zoom: Math.max(map.getZoom(), 15.5), duration: 600, padding: wide() ? { left: 400 } : { bottom: innerHeight * 0.45 } });
  kaartBijwerken();
  draw();
  if (!wide()) setDetent("half");
  body.scrollTop = 0;
}

function sluitKroeg() {
  state.selected = null; state.form = null; state.aanbodForm = null; state.tijdenForm = null; state.info = null;
  kaartBijwerken(); draw();
}

function setTab(t) {
  state.tab = t; state.selected = null; state.form = null; state.aanbodForm = null; state.tijdenForm = null; state.info = null; state.tocht = null;
  document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === t)));
  kaartBijwerken(); draw(); body.scrollTop = 0;
  // Ik bevat formulieren; in de halve stand valt de onderkant buiten beeld
  if (!wide() && t === "ik") setDetent("full");
  else if (!wide() && sheet.dataset.detent === "peek") setDetent("half");
}

async function verstuurPrijs(form) {
  const k = state.kroegen.find((x) => x.id === state.selected);
  const fd = new FormData(form);
  const merk = fd.get("merk") === "_anders" ? String(fd.get("merkAnders") ?? "").trim() : String(fd.get("merk"));
  const prijs = Math.round(parseFloat(String(fd.get("prijs")).replace(",", ".")) * 100);
  if (!merk || merk.length < 2) return toast("Vul een merk in");
  if (!Number.isFinite(prijs) || prijs < 50 || prijs > 2500) return toast("Vul een prijs tussen €0,50 en €25 in");
  const knop = $("#verstuur"); knop.disabled = true; knop.textContent = "Bezig…";
  try {
    let pos = null;
    if (fd.get("locatie")) pos = await locatie();
    let foto_pad = null;
    const file = fd.get("foto");
    if (file && file.size) {
      if (file.size > 5 * 1024 * 1024) throw new Error("Foto is groter dan 5 MB");
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      foto_pad = `${state.sessie.user.id}/${k.id}-${Date.now()}.${ext}`;
      const { error } = await sb.storage.from("prijslijsten").upload(foto_pad, file, { contentType: file.type, upsert: false });
      if (error) throw error;
    }
    const { data, error } = await sb.rpc("meld_prijs", {
      p_kroeg_id: k.id, p_merk: merk, p_volume_cl: state.form.cl, p_prijs_cent: prijs,
      p_lat: pos?.[1] ?? null, p_lon: pos?.[0] ?? null, p_foto_pad: foto_pad,
    });
    if (error) throw error;
    state.form = null;
    if (data.status === "bevestigd") toast(k.versheid === "locked" ? `${k.naam} vrijgespeeld!` : "Prijs bijgewerkt", data.soort === "eerst" ? 50 : 30);
    else if (data.soort === "eerst") toast(`${k.naam} vrijgespeeld! Wacht op bevestiging`);
    else toast("Gemeld, wacht op bevestiging");
    await Promise.all([laadKroegen(), laadStad(), laadMijn()]);
    draw();
  } catch (e) {
    toast(e.message || "Versturen mislukt");
    knop.disabled = false; knop.textContent = "Versturen";
  }
}

// De prijs van de menukaart klopt nog: alleen ter plaatse. De speler wordt indiener; een andere speler bevestigt.
async function menukaartKlopt(id, knop) {
  const k = state.kroegen.find((x) => x.id === id);
  knop.disabled = true; knop.textContent = "Locatie bepalen…";
  const pos = await locatie(10000);
  knop.disabled = false; knop.textContent = "Klopt, ik ben er";
  if (!pos) return toast("Zet je locatie aan: een prijs van de menukaart bevestig je bij de kroeg");
  const { error } = await sb.rpc("meld_prijs", {
    p_kroeg_id: id, p_merk: k.open_merk, p_volume_cl: k.open_volume_cl, p_prijs_cent: k.open_prijs_cent,
    p_lat: pos[1], p_lon: pos[0], p_foto_pad: null,
  });
  if (error) return toast(error.message);
  toast("Je bent de indiener; nu nog een bevestiging van een andere speler");
  await Promise.all([laadKroegen(), laadStad()]);
  draw();
}

async function kloptNog(id) {
  const k = state.kroegen.find((x) => x.id === id);
  const pos = await locatie(4000);
  const { error } = await sb.rpc("klopt_nog", { p_kroeg_id: id, p_lat: pos?.[1] ?? null, p_lon: pos?.[0] ?? null });
  if (error) return toast(error.message);
  toast("Bedankt voor het controleren", dagen(k.laatst_gecontroleerd) >= 90 ? 15 : 5);
  vernieuw();
}

async function inchecken(id, knop) {
  const k = state.kroegen.find((x) => x.id === id);
  if (knop) { knop.disabled = true; knop.textContent = "Locatie zoeken…"; }
  const pos = await locatie(10000);
  if (!pos) { if (knop) { knop.disabled = false; knop.textContent = "Inchecken"; } return toast("Zet je locatie aan om in te checken"); }
  const nieuw = !state.mijn.has(id);
  const { error } = await sb.rpc("inchecken", { p_kroeg_id: id, p_lat: pos[1], p_lon: pos[0] });
  if (error) { toast(error.message); await laadMijn(); return draw(); }
  toast(nieuw ? `Ingecheckt! ${k.naam} staat nu op jouw kaart` : `Ingecheckt bij ${k.naam}`);
  await laadMijn();
  draw();
}

async function wisMijn() {
  if (!confirm("Al je check-ins wissen? Je eigen kaart begint dan weer leeg. Je punten en meldingen blijven.")) return;
  const { error } = await sb.from("incheckingen").delete().eq("gebruiker_id", state.sessie.user.id);
  if (error) return toast(error.message);
  toast("Je check-ins zijn gewist");
  await laadMijn();
  draw();
}

function toonTochtOpKaart() {
  const t = state.tocht;
  const pts = [t.start, ...t.stops.map((k) => [k.lon, k.lat])];
  const b = pts.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
  if (!wide()) setDetent("peek");
  map.fitBounds(b, { padding: wide() ? { left: 420, top: 60, right: 60, bottom: 60 } : { top: 120, left: 40, right: 40, bottom: 190 }, maxZoom: 16.5, duration: 700 });
}

async function beoordeel(g, oordeel) {
  const { data, error } = await sb.rpc("beoordeel", { p_gebeurtenis: g, p_oordeel: oordeel });
  if (error) return toast(error.message);
  toast(data === "bevestigd" ? "Bevestigd, de prijs staat erop" : data === "weerlegd" ? "Weerlegd" : "Oordeel opgeslagen", data === "wacht" ? null : 5);
  vernieuw();
}

// Eventdelegatie
body.addEventListener("click", (e) => {
  const t = e.target.closest("button, a");
  if (!t) return;
  if (t.dataset.kroeg) return openKroeg(t.dataset.kroeg);
  if (t.dataset.back !== undefined) return sluitKroeg();
  if (t.dataset.cancel !== undefined) { state.form = null; state.aanbodForm = null; state.tijdenForm = null; return draw(); }
  if (t.dataset.tijdenform !== undefined) { state.tijdenForm = {}; return draw(); }
  if (t.dataset.sluiting !== undefined) return meldGesloten();
  if (t.dataset.oordeelMelding) return beoordeelMelding(Number(t.dataset.melding), t.dataset.oordeelMelding);
  if (t.dataset.aanbodform !== undefined) { state.aanbodForm = { soort: state.soort || "guinness" }; return draw(); }
  if (t.dataset.oordeelAanbod) return beoordeelAanbod(Number(t.dataset.aanbod), t.dataset.oordeelAanbod);
  if (t.dataset.filter) { state.filter = t.dataset.filter; return draw(); }
  if (t.dataset.periode) { state.periode = t.dataset.periode; return rangView(); }
  if (t.dataset.form) {
    const k = state.kroegen.find((x) => x.id === state.selected);
    state.form = { merk: k?.huidig_merk ?? k?.open_merk ?? "Heineken", cl: k?.huidig_volume_cl ?? k?.open_volume_cl ?? 25, prijs: "", locatie: true };
    return draw();
  }
  if (t.dataset.cl && state.form) {
    state.form.cl = Number(t.dataset.cl);
    document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(b === t)));
    return;
  }
  if (t.dataset.klopt) return kloptNog(Number(t.dataset.klopt));
  if (t.dataset.menuklopt) return menukaartKlopt(Number(t.dataset.menuklopt), t);
  if (t.dataset.inchecken) return inchecken(Number(t.dataset.inchecken), t);
  if (t.dataset.wisMijn !== undefined) return wisMijn();
  if (t.dataset.mijnKaart !== undefined) { setModus("mijn"); if (!wide()) setDetent("peek"); return; }
  if (t.dataset.tochtOpen !== undefined) { planTocht(t.dataset.tochtOpen || undefined); draw(); body.scrollTop = 0; return; }
  if (t.dataset.tochtSluit !== undefined) { state.tocht = null; kaartBijwerken(); return draw(); }
  if (t.dataset.tochtSoort) { planTocht(t.dataset.tochtSoort); return draw(); }
  if (t.dataset.tochtAantal) { planTocht(undefined, Number(t.dataset.tochtAantal)); return draw(); }
  if (t.dataset.tochtKaart !== undefined) return toonTochtOpKaart();
  if (t.dataset.tochtLocatie !== undefined) {
    return locatie().then((pos) => { if (!pos) return toast("Locatie niet beschikbaar"); planTocht(); draw(); });
  }
  if (t.dataset.oordeel) return beoordeel(Number(t.dataset.g), t.dataset.oordeel);
  if (t.dataset.logout !== undefined) {
    if (anoniem() && !confirm("Je speelt zonder e-mailadres. Als je uitlogt, ben je deze speler en je punten kwijt. Toch uitloggen?")) return;
    return sb.auth.signOut();
  }
  if (t.dataset.nieuwecode !== undefined) return stuurCode(state.inlog.email, state.inlog.soort, t, state.inlog.naam);
  if (t.dataset.aanbieder) return inloggenMet(t.dataset.aanbieder, t);
  if (t.dataset.anderadres !== undefined) { state.inlog = null; return draw(); }
  if (t.dataset.import !== undefined) return importeer(t);
});

// Wie iets gaat invullen, krijgt het hele blad te zien
body.addEventListener("focusin", (e) => {
  if (wide() || !e.target.matches("input, select, textarea")) return;
  if (!e.target.matches("[data-zoek]")) setDetent("full");
  // Wacht tot het blad open is en het toetsenbord staat, en zet het veld dan midden in beeld
  setTimeout(() => e.target.scrollIntoView({ block: "center", behavior: "smooth" }), 400);
});

body.addEventListener("change", (e) => {
  if (e.target.matches("[data-soort]")) {
    state.soort = e.target.value;
    if (state.soort && state.filter !== "goedkoop") state.filter = "alles";
    kaartBijwerken();
    draw();
  }
});

body.addEventListener("input", (e) => {
  if (e.target.matches("[data-zoek]")) {
    state.zoek = e.target.value;
    const pos = e.target.selectionStart;
    draw();
    const inp = body.querySelector("[data-zoek]");
    inp.focus(); inp.setSelectionRange(pos, pos);
  }
  if (e.target.name === "merk" && e.target.closest("#prijsForm")) {
    const anders = body.querySelector("[name=merkAnders]");
    anders.style.display = e.target.value === "_anders" ? "" : "none";
  }
});

body.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === "prijsForm") return verstuurPrijs(f);
  if (f.id === "aanbodForm") return verstuurAanbod(f);
  if (f.id === "tijdenForm") return verstuurTijden(f);
  if (f.id === "startForm") {
    const naam = String(new FormData(f).get("naam")).trim();
    onthouden.schrijf({ ...onthouden.lees(), naam });
    const knop = f.querySelector("button[type=submit]");
    knop.disabled = true;
    const { error } = await sb.auth.signInAnonymously({ options: { data: { naam } } });
    knop.disabled = false;
    if (error) return toast(vertaalAuthFout(error));
    // onAuthStateChange zet de sessie en tekent het scherm opnieuw
    return toast("Welkom! Je kunt meteen meespelen");
  }
  if (f.id === "loginForm" || f.id === "koppelForm" || f.id === "aanmeldForm") {
    const fd = new FormData(f);
    const email = String(fd.get("email")).trim().toLowerCase();
    const naam = fd.has("naam") ? String(fd.get("naam")).trim() : undefined;
    onthouden.schrijf({ ...onthouden.lees(), email, ...(naam ? { naam } : {}) });
    const soort = { loginForm: "inloggen", koppelForm: "koppelen", aanmeldForm: "aanmelden" }[f.id];
    return stuurCode(email, soort, f.querySelector("button[type=submit]"), naam);
  }
  if (f.id === "codeForm") {
    const knop = f.querySelector("button[type=submit]");
    knop.disabled = true;
    const code = String(new FormData(f).get("code")).replace(/\D/g, "");
    const koppelen = state.inlog.soort === "koppelen";
    const { error } = await sb.auth.verifyOtp({ email: state.inlog.email, token: code, type: koppelen ? "email_change" : "email" });
    knop.disabled = false;
    if (error) return toast(vertaalAuthFout(error));
    state.inlog = null;
    // onAuthStateChange zet de sessie en tekent het scherm opnieuw
    toast(koppelen ? "Je e-mailadres is gekoppeld. Je punten zijn bewaard" : "Je bent ingelogd");
    if (koppelen) { await laadProfiel(); draw(); }
    return;
  }
  if (f.id === "naamForm") {
    const naam = String(new FormData(f).get("naam")).trim();
    if (!confirm(`Wil je "${naam}" als spelersnaam? Je kunt hem daarna niet meer wijzigen.`)) return;
    const { error } = await sb.from("profielen").update({ naam }).eq("id", state.sessie.user.id);
    if (error) return toast(error.code === "23505" ? "Die naam is al bezet" : error.code === "P0001" ? "Je spelersnaam staat al vast" : "Opslaan lukte niet");
    toast("Naam opgeslagen");
    await laadProfiel(); draw();
  }
});

// Stuurt een code per mail. "inloggen": bestaand account met e-mailadres. "koppelen": een anonieme speler
// koppelt zijn e-mailadres; het account met alle punten blijft hetzelfde. "aanmelden": nieuw account met
// e-mailadres, alleen als anonieme accounts in Supabase uit staan. Normaal beginnen nieuwe spelers anoniem
// (startForm), dus inloggen maakt geen nieuw account aan.
// De code typ je in de app: dat werkt ook als de mail op een ander apparaat of in een andere browser opengaat,
// en een virusscanner van het mailprogramma kan hem niet "opgebruiken" zoals bij een link.
async function stuurCode(email, soort, knop, naam) {
  if (knop) knop.disabled = true;
  const terug = location.origin + location.pathname;
  const { error } = soort === "koppelen"
    ? await sb.auth.updateUser({ email }, { emailRedirectTo: terug })
    : await sb.auth.signInWithOtp({
      email,
      options: soort === "aanmelden"
        ? { shouldCreateUser: true, data: { naam }, emailRedirectTo: terug }
        : { shouldCreateUser: false, emailRedirectTo: terug },
    });
  if (knop) knop.disabled = false;
  if (error) return toast(vertaalAuthFout(error));
  const nieuw = state.inlog == null;
  state.inlog = { email, soort, naam };
  if (nieuw) draw();
  else toast("Nieuwe code verstuurd. Gebruik de nieuwste mail.");
}

async function importeer(knop) {
  knop.disabled = true; knop.textContent = "Bezig met importeren…";
  const { data, error } = await sb.functions.invoke("osm-import", { body: { gemeente: STAD.naam, gemeentecode: STAD.gemeentecode } });
  knop.disabled = false; knop.textContent = "Kroegen en wijken importeren";
  if (error) {
    // De functie geeft de echte reden in het antwoord ({ fout }); supabase-js zegt alleen "non-2xx status code".
    const reden = await error.context?.json?.().then((b) => b?.fout).catch(() => null);
    return toast("Import mislukt: " + (reden ?? "de importfunctie gaf geen antwoord"));
  }
  toast(`${data.kroegen} kroegen en ${data.wijken} wijken geïmporteerd`);
  vernieuw();
}

$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  // Nog eens op het open tabblad: blad helemaal open, of terug naar half
  if (b.dataset.tab === state.tab && state.selected == null && !wide()) return setDetent(sheet.dataset.detent === "full" ? "half" : "full");
  setTab(b.dataset.tab);
});
$("#modus").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setModus(b.dataset.modus); });
$("#ticker").addEventListener("click", (e) => { const b = e.target.closest("[data-kroeg]"); if (b) openKroeg(b.dataset.kroeg); });
$("#hud").addEventListener("click", () => { setTab(state.modus === "mijn" ? "ik" : "beurs"); if (!wide() && sheet.dataset.detent === "peek") setDetent("half"); });
$("#locate").addEventListener("click", async () => {
  const pos = await locatie();
  if (!pos) return toast("Locatie niet beschikbaar");
  map.easeTo({ center: pos, zoom: 16 });
  draw();
});

// ---------------------------------------------------------------------------
// Realtime: wijzigingen van andere spelers direct tonen
// ---------------------------------------------------------------------------

sb.channel("stad")
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "gebeurtenissen" }, (p) => {
    if (p.new.door_id !== state.sessie?.user?.id) {
      const k = state.kroegen.find((x) => x.id === p.new.kroeg_id);
      if (k) toast(p.new.soort === "check" ? `${k.naam} is net gecontroleerd` : `Nieuwe prijs bij ${k.naam}`);
    }
    vernieuw();
  })
  .on("postgres_changes", { event: "UPDATE", schema: "public", table: "gebeurtenissen" }, () => vernieuw())
  .on("postgres_changes", { event: "*", schema: "public", table: "kroegen" }, () => vernieuw())
  .on("postgres_changes", { event: "*", schema: "public", table: "kroeg_aanbod" }, () => vernieuw())
  .on("postgres_changes", { event: "*", schema: "public", table: "kroeg_meldingen" }, () => vernieuw())
  .subscribe();

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

sb.auth.onAuthStateChange((gebeurtenis, sessie) => {
  state.sessie = sessie;
  // Bij koppelen bestaat de sessie al; dan blijft het codeformulier staan tot de code is ingevuld
  if (!sessie || (state.inlog && state.inlog.soort !== "koppelen")) state.inlog = null;
  // Tokenvernieuwing: niets opnieuw laden
  if (gebeurtenis === "TOKEN_REFRESHED") return;
  // Niet binnen deze callback op Supabase wachten: supabase-js houdt dan nog een slot vast en de app kan vastlopen.
  setTimeout(async () => {
    await Promise.all([laadProfiel(), laadMijn()]);
    if (!bezigMetTypen()) draw();
  }, 0);
});

(async function start() {
  if (urlFout) {
    const f = urlFout.toLowerCase();
    toast(f.includes("otp") || f.includes("link")
      ? "Deze inloglink is verlopen of al gebruikt. Log in met de code uit de nieuwste mail."
      : f.includes("identity") && f.includes("exists")
        ? "Dit Apple- of Google-account hoort al bij een andere speler."
        : f.includes("access_denied") || f.includes("cancel")
          ? "Inloggen is afgebroken."
          : "Inloggen met Apple of Google lukte niet. Probeer het opnieuw of gebruik je e-mailadres.");
    history.replaceState(null, "", location.pathname);
    state.tab = "ik";
    document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === "ik")));
  }
  const { data } = await sb.auth.getSession();
  state.sessie = data.session;
  await Promise.all([laadKroegen(), laadStad(), laadProfiel(), laadAanbieders(), laadAanbod(), laadMijn(), laadKoers()]);
  koersen(); lichtkrant(); hud(); kaartBijwerken();
  draw();
  setDetent("half");
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
