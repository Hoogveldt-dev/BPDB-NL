// Bierkoers: echte app op Supabase.
// Kaart (MapLibre + OpenFreeMap), inloggen, prijzen melden en bevestigen, foto's, realtime,
// inchecken met een eigen kaart (Mijn kroegen) en een kroegentochtplanner.
// Alles in de stijl van een beurs: lichtkrant, tickercodes, koersverschil en de Pilsindex van de stad.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY, STAD, KAARTSTIJL } from "./config.js";

const maplibregl = window.maplibregl;

// Stad: de gekozen stad (Ik, Stad), bewaard in localStorage als bierkoers-stad. Standaard de pilotstad uit config.js.
// De lijst met steden komt uit stad_voortgang: elke gemeente met kroegen doet mee.
let stadNaam = (() => { try { return localStorage.getItem("bierkoers-stad") || STAD.naam; } catch { return STAD.naam; } })();
// Bij een andere stad dan de pilotstad springt de kaart naar het midden van de kroegen zodra die geladen zijn
let kaartNaarStad = stadNaam !== STAD.naam;

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

// Taal: Nederlands of Engels (Ik, Taal). Zonder keuze Nederlands als de browser Nederlands kent, anders Engels.
// In het Engels vertaalt de tekstvervanger hieronder (teksten) elke zichtbare tekst met het woordenboek uit en.js.
const TAAL = (() => {
  try { const t = localStorage.getItem("bierkoers-taal"); if (t === "nl" || t === "en") return t; } catch { /* privévenster */ }
  return (navigator.languages ?? [navigator.language ?? "nl"]).some((l) => /^nl\b/i.test(l)) ? "nl" : "en";
})();
const LOCALE = TAAL === "en" ? "en-GB" : "nl-NL";
const EN = TAAL === "en" ? await import("./en.js").then((m) => m.EN).catch(() => null) : null;
document.documentElement.lang = TAAL;
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const euro = (cent) => cent == null ? "" : "€ " + (cent / 100).toFixed(2).replace(".", ",");
const dagen = (iso) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null;
const wanneer = (iso) => {
  const d = dagen(iso);
  if (d == null) return "";
  if (d === 0) return "vandaag";
  if (d === 1) return "gisteren";
  if (d < 30) return `${d} dagen geleden`;
  return new Date(iso).toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "numeric" });
};
const VERSHEID = { fresh: "Vers", stale: "Wordt oud", old: "Oud, controleer", locked: "Nog geen prijs", wacht: "Wacht op bevestiging" };
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
const ICON_LOCATIE = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.6 3.4 3.9 10.2c-.9.4-.8 1.6.1 1.9l6.6 1.9 1.9 6.6c.3.9 1.5 1 1.9.1l6.8-16.7c.3-.7-.4-1.4-1.1-1.1z"/></svg>`;
const ICON_ROUTE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16"/></svg>`;
const ICON_GLAS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h10v15a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M16 8h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M9 9v8M12.5 9v8"/></svg>`;

function toast(msg, pts) {
  const t = $("#toast");
  t.innerHTML = esc(msg) + (pts ? `<span class="pts">${pts > 0 ? "+" : ""}${pts}</span>` : "");
  t.classList.add("show");
  clearTimeout(toast.t);
  // Een lange melding blijft langer staan, zodat je hem kunt uitlezen
  toast.t = setTimeout(() => t.classList.remove("show"), String(msg).length > 70 ? 5200 : 3200);
}

// Fouten uit de database en de functies in gewone taal. De spelregels melden al in het Nederlands;
// technische meldingen van Supabase of het netwerk vertalen we, of we geven een algemene zin.
async function leesFout(fout) {
  let m = String(fout?.message ?? fout ?? "");
  const ctx = fout?.context;
  if (ctx && typeof ctx.clone === "function") {
    try {
      const j = await ctx.clone().json();
      if (j?.fout) return j.fout;
      if (typeof j?.message === "string") m = j.message;
    } catch { /* geen JSON in het antwoord */ }
  }
  if (fout?.code === "23505") return "Dit bestaat al.";
  if (/failed to fetch|networkerror|load failed|network request/i.test(m)) return "Geen verbinding. Controleer je internet en probeer het opnieuw.";
  if (/jwt|token.*expired|not authenticated|invalid claim/i.test(m)) return "Je sessie is verlopen. Ververs de pagina en probeer het opnieuw.";
  if (/permission denied|row-level security/i.test(m)) return "Dat mag je hier niet doen.";
  if (/violates check constraint|invalid input/i.test(m)) return "Deze invoer klopt niet. Kijk hem nog even na.";
  if (/non-2xx|edge function|unexpected|\b(could not|failed|error|the)\b/i.test(m)) return "Er ging iets mis. Probeer het later opnieuw.";
  return m || "Er ging iets mis. Probeer het opnieuw.";
}

// Vraag om bevestiging in een eigen venster (geen confirm() van de browser: die blokkeert en past niet in de PWA).
function vraag(tekst, ja = "Doorgaan", { gevaar = true } = {}) {
  return new Promise((resolve) => {
    const m = $("#modal"), knopJa = $("#modalJa"), knopNee = $("#modalNee");
    $("#modalText").textContent = tekst;
    knopJa.textContent = ja;
    knopJa.className = `btn ${gevaar ? "bad" : "primary"}`;
    m.hidden = false;
    knopNee.focus();
    const klaar = (v) => {
      m.hidden = true;
      knopJa.onclick = knopNee.onclick = m.onkeydown = null;
      resolve(v);
    };
    knopJa.onclick = () => klaar(true);
    knopNee.onclick = () => klaar(false);
    m.onkeydown = (e) => { if (e.key === "Escape") klaar(false); };
  });
}

// Foto van een prijslijst binnen de app tonen; een nieuw tabblad is in een PWA onhandig
function openFoto(url) {
  $("#lightboxImg").src = url;
  $("#lightbox").hidden = false;
  $("#lightboxSluit").focus();
}

// ---------------------------------------------------------------------------
// Teksten: een beheerder kan elke zichtbare tekst in de app herschrijven (tabel app_teksten, functie zet_tekst).
// De sleutel is de standaardtekst met elk getal als #. Een MutationObserver vervangt elke tekst die
// verschijnt; zo hoeft de code van de app niet te veranderen. Bij het invullen wordt # weer het getal.
// ---------------------------------------------------------------------------

const teksten = (() => {
  const eigen = new Map(); // sleutel -> eigen tekst
  const bron = new WeakMap(); // tekstnode of [element, attribuut] -> standaardtekst
  const gezet = new WeakMap(); // wat wij er zelf in zetten, om eigen wijzigingen te herkennen
  const NIET = "script, style, #tekstEditor, #tekstBalk, [data-geen-teksten]";
  const sleutelVan = (t) => t.trim().replace(/\s+/g, " ").replace(/\d+/g, "#");
  const telt = (t) => /\p{L}/u.test(t); // alleen teksten met letters; prijzen en getallen alleen niet
  const vul = (sjabloon, origineel) => {
    const getallen = origineel.match(/\d+/g) ?? [];
    let i = 0;
    return sjabloon.replace(/#/g, () => getallen[i++] ?? "#");
  };
  let bewerken = false, pauze = false;

  // Engels: exacte sleutels, en sleutels met * (tekst die de app invult) als patroon. Wat de * vangt, vertalen we ook.
  const vertaling = EN ? new Map(Object.entries(EN)) : null;
  const patronen = !EN ? [] : Object.entries(EN).filter(([k]) => k.includes("*"))
    .map(([k, en]) => [new RegExp("^" + k.split("*").map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(.+?)") + "$"), en, k.replace(/\*/g, "").length])
    .sort((a, b) => b[2] - a[2]);
  function vertaal(sleutel, diepte = 0) {
    if (vertaling.has(sleutel)) return vertaling.get(sleutel);
    for (const [re, en] of patronen) {
      const m = sleutel.match(re);
      if (!m) continue;
      let i = 1;
      return en.replace(/\*/g, () => {
        const deel = m[i++] ?? "", kern = deel.trim();
        const v = diepte < 2 && kern ? vertaal(kern, diepte + 1) : null;
        return v == null ? deel : deel.replace(kern, v);
      });
    }
    return null;
  }
  const doelTekst = (orig) => {
    const sleutel = sleutelVan(orig);
    let nieuw = vertaling ? vertaal(sleutel) : eigen.get(sleutel);
    // Regels als "HAAN · Nijmegen-Oost · Nog geen prijs": elk stuk apart vertalen
    if (nieuw == null && vertaling && sleutel.includes(" · ")) {
      const delen = sleutel.split(" · "), vertaald = delen.map((d) => vertaal(d) ?? d);
      if (vertaald.some((d, i) => d !== delen[i])) nieuw = vertaald.join(" · ");
    }
    return nieuw == null ? null : vul(nieuw, orig);
  };

  function standaard(node) {
    const nu = node.nodeValue;
    if (gezet.get(node) === nu && bron.has(node)) return bron.get(node);
    bron.set(node, nu);
    return nu;
  }
  function tekstNode(node) {
    if (!node.nodeValue || !node.nodeValue.trim() || node.parentElement?.closest(NIET)) return;
    const orig = standaard(node);
    if (!telt(orig)) return;
    const nieuw = doelTekst(orig);
    const doel = nieuw == null ? orig : orig.match(/^\s*/)[0] + nieuw + orig.match(/\s*$/)[0];
    if (node.nodeValue !== doel) { gezet.set(node, doel); node.nodeValue = doel; }
  }
  function placeholder(el) {
    if (el.closest(NIET)) return;
    let orig = el.dataset.standaardPlaceholder;
    if (orig == null || el.getAttribute("placeholder") !== el.dataset.gezetPlaceholder) {
      orig = el.getAttribute("placeholder") ?? "";
      el.dataset.standaardPlaceholder = orig;
    }
    const doel = doelTekst(orig) ?? orig;
    el.dataset.gezetPlaceholder = doel;
    if (el.getAttribute("placeholder") !== doel) el.setAttribute("placeholder", doel);
  }
  function loop(wortel) {
    if (wortel.nodeType === Node.TEXT_NODE) return tekstNode(wortel);
    if (wortel.nodeType !== Node.ELEMENT_NODE) return;
    const w = document.createTreeWalker(wortel, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) tekstNode(w.currentNode);
    if (wortel.matches?.("[placeholder]")) placeholder(wortel);
    wortel.querySelectorAll?.("[placeholder]").forEach(placeholder);
  }
  new MutationObserver((lijst) => {
    if (!eigen.size && !vertaling) return;
    for (const m of lijst) {
      if (m.type === "characterData") tekstNode(m.target);
      else if (m.type === "attributes") placeholder(m.target);
      else m.addedNodes.forEach(loop);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["placeholder"] });

  if (vertaling) loop(document.body);
  async function laad() {
    if (vertaling) return; // eigen teksten van de beheerder zijn Nederlands
    const { data, error } = await sb.from("app_teksten").select("sleutel,tekst");
    if (error) return; // tabel nog niet live: standaardteksten
    eigen.clear();
    for (const r of data ?? []) eigen.set(r.sleutel, r.tekst);
    loop(document.body);
  }

  // Bewerkstand: tik op een tekst en pas hem aan
  let doel = null; // { sleutel, standaard }
  function zetBewerken(aan) {
    bewerken = aan; pauze = false;
    document.documentElement.dataset.teksten = aan ? "bewerken" : "";
    $("#tekstBalk").hidden = !aan;
    $("#tekstPauze").setAttribute("aria-pressed", "false");
    $("#tekstPauze").textContent = "Even bladeren";
    $("#tekstUitleg").textContent = "Tik op een tekst om hem aan te passen";
  }
  // Even bladeren: tikken werkt weer gewoon, zodat je naar een ander scherm kunt
  $("#tekstPauze").addEventListener("click", () => {
    pauze = !pauze;
    document.documentElement.dataset.teksten = pauze ? "pauze" : "bewerken";
    $("#tekstPauze").setAttribute("aria-pressed", String(pauze));
    $("#tekstPauze").textContent = pauze ? "Verder aanpassen" : "Even bladeren";
    $("#tekstUitleg").textContent = pauze ? "Ga naar het scherm met de tekst" : "Tik op een tekst om hem aan te passen";
  });
  function nodeOnder(e) {
    const r = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    const p = document.caretPositionFromPoint?.(e.clientX, e.clientY);
    const n = r?.startContainer ?? p?.offsetNode;
    if (n?.nodeType === Node.TEXT_NODE && n.nodeValue.trim()) return n;
    const w = document.createTreeWalker(e.target, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) if (w.currentNode.nodeValue.trim()) return w.currentNode;
    return null;
  }
  document.addEventListener("click", (e) => {
    if (!bewerken || pauze || e.target.closest("#tekstBalk, #tekstEditor")) return;
    e.preventDefault(); e.stopPropagation();
    let orig = null;
    if (e.target.matches("input[placeholder], textarea[placeholder]")) orig = e.target.dataset.standaardPlaceholder ?? e.target.getAttribute("placeholder");
    else {
      const n = nodeOnder(e);
      if (n) orig = bron.get(n) ?? n.nodeValue;
    }
    if (!orig || !telt(orig)) return toast("Hier staat geen tekst om aan te passen");
    doel = { sleutel: sleutelVan(orig), standaard: orig.trim() };
    $("#tekstStandaard").textContent = doel.sleutel;
    $("#tekstNieuw").value = eigen.get(doel.sleutel) ?? doel.sleutel;
    $("#tekstEditor").hidden = false;
    $("#tekstNieuw").focus();
  }, true);
  async function bewaar(tekst) {
    const { error } = await sb.rpc("zet_tekst", { p_sleutel: doel.sleutel, p_tekst: tekst });
    if (error) return toast(await leesFout(error));
    const schoon = tekst.trim();
    if (!schoon || schoon === doel.sleutel) eigen.delete(doel.sleutel); else eigen.set(doel.sleutel, schoon);
    $("#tekstEditor").hidden = true;
    loop(document.body);
    toast(eigen.has(doel.sleutel) ? "Tekst aangepast" : "Standaardtekst staat er weer");
  }
  $("#tekstForm").addEventListener("submit", (e) => { e.preventDefault(); bewaar($("#tekstNieuw").value); });
  $("#tekstStandaardKnop").addEventListener("click", () => bewaar(""));
  $("#tekstAnnuleer").addEventListener("click", () => { $("#tekstEditor").hidden = true; });
  $("#tekstKlaar").addEventListener("click", () => zetBewerken(false));

  return {
    laad, zetBewerken,
    lijst: () => [...eigen.entries()],
    // Een eigen tekst weghalen vanuit het overzicht in Beheer
    async wis(sleutel) { doel = { sleutel, standaard: sleutel }; await bewaar(""); },
  };
})();

// Betrouwbaarheid in woorden: zonder punten ben je nieuw, niet onbetrouwbaar
const betrouwTekst = (r) => !r || (r.altijd ?? 0) === 0 ? "nieuw, nog weinig bevestigd" : `betrouwbaarheid ${Math.round(r.betrouwbaarheid)}%`;

const meters = (d) => d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1).replace(".", ",")} km`;
const keer = (n) => (TAAL === "en" ? (n === 1 ? "once" : `${n} times`) : n === 1 ? "1 keer" : `${n} keer`);
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
  badgeTellers: {}, // tellers voor de badges onder Ik (laadBadges)
  uitgeklapt: new Set(), // namen van open uitklapblokken (data-onthoud), zie uitgeklapt()
  steden: [], // alle steden die meedoen (stad_voortgang), voor de stadskeuze onder Ik
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
  // Inloggen met een e-mailadres zonder account: dat adres, zodat we een nieuw account kunnen aanbieden
  nieuwAdres: null,
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
  modus: "samen", // kaart: "samen" (de prijzen van iedereen), "koers" of "mijn" (waar jij hebt ingecheckt, onder je eigen mist)
  tocht: null, // { soort: "nieuw" | "goedkoop", aantal, stops: [kroeg], start: [lon, lat], vanaf: "jij" | "centrum" }
  // Koers: prijsgeschiedenis uit kroeg_tijdlijn, punten per kroeg, de Pilsindex en tickercodes (zie koersen())
  // Lijst: alleen kroegen in beeld, een gekozen wijk (vanuit Beurs) en hoeveel rijen er staan
  pagina: null, // "regels": de spelregels
  wijk: null,
  limiet: 40,
  // Kroeg waar je naartoe teruggaat na het inloggen
  terugNaar: null,
  // Anoniem beginnen lukte niet (staat in Supabase uit, of te veel nieuwe accounts): dan het gewone aanmeldscherm
  anoniemMislukt: false,
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
const datumTekst = (d) => new Date(d).toLocaleDateString(LOCALE, { day: "numeric", month: "long", year: "numeric" });
// Alleen de bron zelf ("Drankkaart dekluizenaar.nl"); de datum staat er al naast
const bronKort = (s) => (s ?? "").split(/[,(]/)[0].trim() || "menukaart";

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

// Voorlopig is pils het enige spel. Ander bier staat uit, met een uitzondering: Guinness, als extraatje.
// In de Guinness-stand (state.soort = "guinness") kleurt de app groen, staan alleen kroegen met Guinness op
// de kaart en is de Guinnessprijs de prijs die je ziet. Geen punten, net als ander extra bier.
const GUINNESS = "guinness";
const PINT = 50; // Guinness vergelijken we per pint van 50 cl
const guinnessAan = () => state.soort === GUINNESS;
const perPint = (a) => (a?.prijs_cent && a.volume_cl ? Math.round((a.prijs_cent * PINT) / a.volume_cl) : null);
function setGuinness(aan) {
  state.soort = aan ? GUINNESS : "";
  document.documentElement.dataset.bier = aan ? GUINNESS : "pils";
  $("#guinness").setAttribute("aria-pressed", String(aan));
  if (aan && !["alles", "goedkoop"].includes(state.filter)) state.filter = "alles";
  state.limiet = 40;
  // Kleuren van de kaart en de mist lezen de nieuwe tinten opnieuw in
  mist.thema();
  kaartBijwerken(); hud(); draw();
  if (aan && !zichtbareKroegen().length) toast("Nog geen kroeg met Guinness gemeld. Weet je er een? Meld het bij de kroeg.");
}
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
  if (m.includes("signups not allowed for otp")) return "Dit e-mailadres hoort nog niet bij een account. Maak er hierboven een account mee.";
  if (m.includes("already been registered") || m.includes("email_exists"))
    return "Dit e-mailadres hoort al bij een account. Log ermee in onder Al een account?; je bijdragen gaan mee.";
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
// bekende prijs per vaasje van alle kroegen in de stad. Menukaarten zijn basisdata die we zelf
// invoeren: ze tellen mee in de koers, maar zijn geen melding (niet in "Laatste meldingen" en
// niet in de activiteit van de lichtkrant).
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
// De prijs per vaasje die de kaart toont: de koers (ook van de menukaart), anders de bevestigde of een wachtende prijs
const prijsPer25 = (k) => koersVan(k.id)?.nu ?? k.per25_cent ?? k.open_per25_cent ?? null;

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

const maandJaar = (t) => new Date(t).toLocaleDateString(LOCALE, { month: "short", year: "numeric" }).replace(".", "");
const maandKort = (t) => new Date(t).toLocaleDateString(LOCALE, { month: "short" }).replace(".", "");

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
  // Daarnaast de laatste activiteit van spelers voor de lichtkrant: controles komen veel vaker voor dan prijswijzigingen.
  const [{ data, error }, { data: recent }] = await Promise.all([
    sb.from("kroeg_tijdlijn").select("kroeg_id,soort,status,prijs_cent,volume_cl,op,bron").eq("gemeente", stadNaam)
      .neq("soort", "check").or("status.eq.bevestigd,bron.eq.menukaart").order("op", { ascending: true }).limit(5000),
    sb.from("kroeg_tijdlijn").select("kroeg_id,soort,status,op").eq("gemeente", stadNaam).eq("status", "bevestigd").eq("bron", "speler").order("op", { ascending: false }).limit(20),
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
  const totaal = state.kroegen.length, metPrijs = inKaart();
  if (totaal) items.push(`<span class="tk"><b>${esc(stadNaam.toUpperCase())}</b>${metPrijs}/${totaal} <span class="zacht">in kaart</span></span>`);
  if (totaal - metPrijs > 0) items.push(`<span class="tk"><span class="zacht">${totaal - metPrijs} kroegen zonder prijs</span></span>`);
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
  return { fg: v("--fg"), fresh: v("--fresh"), stale: v("--stale"), old: v("--old"), locked: v("--locked"), wacht: v("--wacht"), accent: v("--accent"), accentInk: v("--accent-ink"), surface: v("--surface"), blue: v("--blue"), op: v("--op"), af: v("--af") };
}

// Prijzen pas op de kaart als je op straatniveau kijkt; in de koersstand iets eerder
const prijsZoom = () => (state.modus === "koers" ? 15 : 16);

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
        versheid: kroegVersheid(k),
        label: state.soort ? (soortIn(k.id)?.prijs_cent ? euro(soortIn(k.id).prijs_cent) : "?") : toonPrijsTekst(k),
        bezocht: state.mijn.has(k.id),
        per25: prijsPer25(k) ?? 0,
      },
    })),
  };
}

// Samen: kleur is versheid. Koers: groen onder de Pilsindex, goud rond de index, rood erboven.
// Mijn kaart: goud waar je hebt ingecheckt, de rest grijs onder je eigen mist.
function cirkelStijl() {
  const c = kleur();
  if (guinnessAan()) {
    return { "circle-color": c.accent, "circle-opacity": 1, "circle-stroke-color": "#ffffff" };
  }
  if (state.modus === "koers") {
    const idx = state.koers.index?.nu;
    const prijs = [">", ["get", "per25"], 0];
    return {
      "circle-color": ["case", prijs, idx ? ["interpolate", ["linear"], ["/", ["get", "per25"], idx], 0.85, c.af, 1, c.accent, 1.15, c.op] : c.accent, c.locked],
      "circle-opacity": ["case", prijs, 1, 0.35],
      "circle-stroke-color": "#ffffff",
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
    // Kroegen op slot zijn grijs, maar goed zichtbaar: ze laten zien waar de kroegen zijn
    "circle-opacity": ["case", ["==", ["get", "versheid"], "locked"], 0.85, 1],
    "circle-stroke-color": ["case", ["==", ["get", "versheid"], "locked"], c.surface, "#ffffff"],
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

// De donkere stijl van OpenFreeMap is bijna zwart: straten, water en namen vallen weg, zeker onder de mist.
// Daarom zetten we hem lichter, naar de donkere stand van Kaarten: grijze straten, blauw water, leesbare namen.
// De grijzen zijn warm, zoals de inkt en het grijs van het visitekaartje. Zo kun je je oriënteren,
// ook als er nog weinig is vrijgespeeld.
const DONKERE_KAART = [
  [/^background$/, { "background-color": "#1b1a17" }],
  [/^(water|waterway)$/, { "fill-color": "#14304a", "line-color": "#14304a" }],
  [/^(landuse_park|landcover_wood)$/, { "fill-color": "#1e2b20" }],
  [/^landuse_residential$/, { "fill-color": "#22201c" }],
  [/^building$/, { "fill-color": "#2b2924", "fill-outline-color": "#34312b" }],
  [/^highway_path$/, { "line-color": "#34312b" }],
  [/^(highway_minor|highway_motorway_subtle)$/, { "line-color": "#403d36" }],
  [/^(highway_major_inner|highway_major_subtle)$/, { "line-color": "#504c44" }],
  [/^highway_motorway_inner$/, { "line-color": "#6b665d" }],
  [/^railway(_transit|_minor)?$/, { "line-color": "#4a4740" }],
  [/^railway.*_dashline$/, { "line-color": "#1b1a17" }],
  [/^highway_name/, { "text-color": "#b3ada3", "text-halo-color": "#1b1a17" }],
  [/^place_/, { "text-color": "#ece4d2", "text-halo-color": "rgba(14,14,14,0.75)" }],
  [/^water_name$/, { "text-color": "#64a0d2", "text-halo-color": "rgba(14,14,14,0.6)" }],
];
// De lichte stijl (Positron) is koel grijs. In de kleuren van het kaartje: crème papier, witte wegen
// met randen in het warm grijs #D9CFBC, namen in inkt. Water en groen blijven herkenbaar.
const LICHTE_KAART = [
  [/^(background|road_area_pier)$/, { "background-color": "#f5edda", "fill-color": "#f5edda" }],
  [/^road_pier$/, { "line-color": "#f5edda" }],
  [/^landuse_residential$/, { "fill-color": "#efe5cf" }],
  [/^building$/, { "fill-color": "#e8dcc3", "fill-outline-color": "#d9cfbc" }],
  [/^park$/, { "fill-color": "#e2e3cd" }],
  [/^landcover_wood$/, { "fill-color": "#d9dcc4" }],
  [/^water$/, { "fill-color": "#c3cdcc" }],
  [/^highway_path$/, { "line-color": "#e9dfc9" }],
  [/^highway_minor$/, { "line-color": "#e4d9c2" }],
  [/^(highway_major_casing|highway_motorway_casing|highway_motorway_bridge_casing|tunnel_motorway_casing)$/, { "line-color": "#d9cfbc" }],
  [/^(railway|railway_transit|railway_service)$/, { "line-color": "#d9cfbc" }],
  [/^highway-name/, { "text-color": "#6a665e", "text-halo-color": "#f5edda" }],
  [/^label_/, { "text-color": "#0e0e0e", "text-halo-color": "#fff6e0" }],
];
function kaartKleuren() {
  const tabel = donker.matches ? DONKERE_KAART : LICHTE_KAART;
  for (const laag of map.getStyle()?.layers ?? []) {
    for (const [patroon, verf] of tabel) {
      if (!patroon.test(laag.id)) continue;
      // Alleen eigenschappen die bij het soort laag horen: fill-color bij een vlak, text-color bij tekst
      const soort = laag.type === "symbol" ? "text" : laag.type;
      for (const [k, v] of Object.entries(verf)) if (k.split("-")[0] === soort) map.setPaintProperty(laag.id, k, v);
    }
  }
}

function kaartLagen() {
  const c = kleur();
  kaartKleuren();
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
  // Een zachte schaduw onder elke kroeg, zoals de punten in Kaarten
  map.addLayer({
    id: "kroeg-schaduw", type: "circle", source: "kroegen",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 6, 14, 9, 16, 12, 18, 14],
      "circle-color": "#000", "circle-opacity": ["case", ["==", ["get", "versheid"], "locked"], 0, 0.22], "circle-blur": 0.7, "circle-translate": [0, 1],
    },
  });
  map.addLayer({
    id: "kroeg-cirkel", type: "circle", source: "kroegen",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 4.5, 14, 7, 16, 9.5, 18, 11],
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 11, 1.5, 15, 2.5],
      ...cirkelStijl(),
    },
  });
  // Je eigen locatie, zodra je die hebt gedeeld
  map.addSource("ik", { type: "geojson", data: ikGeojson() });
  map.addLayer({
    id: "ik-stip", type: "circle", source: "ik",
    paint: { "circle-radius": 7, "circle-color": c.blue, "circle-stroke-width": 3, "circle-stroke-color": "#ffffff" },
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
    id: "kroeg-prijs", type: "symbol", source: "kroegen", minzoom: prijsZoom(),
    filter: ["!=", ["get", "label"], ""],
    layout: {
      "text-field": ["get", "label"],
      "text-font": ["Noto Sans Bold"],
      "text-size": 12,
      "text-offset": [0, -1.4],
      "text-allow-overlap": false,
    },
    paint: { "text-color": c.fg, "text-halo-color": c.surface, "text-halo-width": 1.6 },
  });
  // Onzichtbare, grotere tikplek per kroeg: een stip van 9 px is met een duim lastig te raken
  map.addLayer({
    id: "kroeg-tik", type: "circle", source: "kroegen",
    paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 12, 15, 20, 18, 24], "circle-color": "#000", "circle-opacity": 0.01 },
  });
}

const ikGeojson = () => ({ type: "FeatureCollection", features: state.pos ? [{ type: "Feature", geometry: { type: "Point", coordinates: state.pos }, properties: {} }] : [] });

// Tikken: bij overlappende tikplekken de kroeg die het dichtst bij de vinger ligt.
// De handlers horen bij de laag-id en blijven dus werken na een wissel van licht naar donker.
map.on("click", "kroeg-tik", (e) => {
  let beste = null, d = Infinity;
  for (const f of e.features ?? []) {
    const p = map.project(f.geometry.coordinates), dd = (p.x - e.point.x) ** 2 + (p.y - e.point.y) ** 2;
    if (dd < d) { d = dd; beste = f; }
  }
  if (beste) openKroeg(beste.properties.id);
});
const muisTip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, className: "kroeg-tip", maxWidth: "260px" });
map.on("mouseenter", "kroeg-tik", () => (map.getCanvas().style.cursor = "pointer"));
map.on("mouseleave", "kroeg-tik", () => { map.getCanvas().style.cursor = ""; muisTip.remove(); });
// Alleen met een muis: naam en prijs als je over een kroeg beweegt
map.on("mousemove", "kroeg-tik", (e) => {
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  const f = e.features?.[0], k = f && state.kroegen.find((x) => x.id === f.properties.id);
  if (!k) return;
  const prijs = toonPrijsTekst(k);
  muisTip.setLngLat(f.geometry.coordinates)
    .setHTML(`<b>${codeHtml(k.id)}${esc(k.naam)}</b><span class="muted"> ${prijs ? esc(prijs) : "nog geen prijs"}</span>`).addTo(map);
});

// ---------------------------------------------------------------------------
// Mist: een stippenraster over de kaart, alleen op Mijn kaart, met een open plek rond elke kroeg waar jij hebt ingecheckt.
// De gezamenlijke kaart heeft geen mist: die zou na de eerste spelers voor altijd open zijn.
// Getekend op een eigen canvas boven de kaart, dus de kaart zelf blijft gewoon te bedienen.
// ---------------------------------------------------------------------------

const MIST_M = 110; // straal van een open plek in meters
const mist = (() => {
  const doek = document.createElement("canvas");
  doek.className = "mist";
  doek.setAttribute("aria-hidden", "true");
  map.getCanvasContainer().appendChild(doek);
  const ctx = doek.getContext("2d");
  const groei = new Map(); // kroeg_id -> begin van de animatie
  let kleuren = null, patroon = null;
  const rustig = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  function lees() {
    const cs = getComputedStyle(document.documentElement);
    kleuren = { waas: cs.getPropertyValue("--mist").trim(), stip: cs.getPropertyValue("--mist-stip").trim() };
    const dpr = devicePixelRatio || 1, n = Math.round(12 * dpr);
    const tegel = document.createElement("canvas");
    tegel.width = tegel.height = n;
    const t = tegel.getContext("2d");
    t.fillStyle = kleuren.stip;
    t.beginPath(); t.arc(n / 2, n / 2, 1.1 * dpr, 0, Math.PI * 2); t.fill();
    patroon = ctx.createPattern(tegel, "repeat");
  }

  const open = (k) => state.mijn.has(k.id);

  function teken() {
    if (!kleuren) lees();
    const dpr = devicePixelRatio || 1, el = map.getCanvas(), w = el.clientWidth, h = el.clientHeight;
    if (doek.width !== Math.round(w * dpr) || doek.height !== Math.round(h * dpr)) {
      doek.width = Math.round(w * dpr); doek.height = Math.round(h * dpr);
      doek.style.width = w + "px"; doek.style.height = h + "px";
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, doek.width, doek.height);
    if (state.modus !== "mijn" || guinnessAan()) return;
    ctx.fillStyle = kleuren.waas; ctx.fillRect(0, 0, doek.width, doek.height);
    if (kleuren.stip && kleuren.stip !== "transparent") { ctx.fillStyle = patroon; ctx.fillRect(0, 0, doek.width, doek.height); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "destination-out";
    const lat = map.getCenter().lat * Math.PI / 180;
    const mPerPx = (40075016.686 * Math.cos(lat)) / (512 * 2 ** map.getZoom());
    const R = Math.max(16, MIST_M / mPerPx), nu = performance.now();
    let bezig = false;
    for (const k of state.kroegen) {
      if (!open(k) && !groei.has(k.id)) continue;
      const p = map.project([k.lon, k.lat]);
      if (p.x < -R || p.y < -R || p.x > w + R || p.y > h + R) continue;
      let f = 1;
      const t0 = groei.get(k.id);
      if (t0 != null) {
        const x = Math.min(1, Math.max(0, (nu - t0) / 1600));
        f = 1 - (1 - x) ** 3;
        if (x < 1) bezig = true; else groei.delete(k.id);
      }
      const r = R * f;
      if (r < 1) continue;
      const g = ctx.createRadialGradient(p.x, p.y, r * 0.45, p.x, p.y, r);
      g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    }
    // Geen open plek rond je eigen locatie: daar sta je bij het inchecken, en dan zou je het wegtrekken niet zien
    if (bezig) map.triggerRepaint();
  }

  map.on("render", teken);
  donker.addEventListener("change", () => { kleuren = null; map.triggerRepaint(); });
  return {
    thema() { kleuren = null; map.triggerRepaint(); },
    bij: () => map.triggerRepaint(),
    // De mist trekt weg rond deze kroeg: de open plek groeit vanuit het midden
    // na: wacht zo veel ms voordat de plek opengaat (de open plek blijft tot dan dicht)
    vier(id, na = 0) { if (!rustig()) { groei.set(id, performance.now() + na); map.triggerRepaint(); } },
  };
})();

// Een nieuwe kroeg: een gouden kring dijt uit, en op Mijn kaart trekt de mist weg rond de kroeg
function vierVrij(k, metMist = true) {
  if (!k || !kaartKlaar) return;
  if (metMist) mist.vier(k.id);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const p = map.project([k.lon, k.lat]), r = map.getContainer().getBoundingClientRect();
  for (const extra of ["", " twee"]) {
    const kring = document.createElement("div");
    kring.className = "kring" + extra;
    kring.style.left = r.left + p.x + "px";
    kring.style.top = r.top + p.y + "px";
    document.body.appendChild(kring);
    kring.addEventListener("animationend", () => kring.remove());
  }
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
  map.getSource("ik")?.setData(ikGeojson());
  mist.bij();
  if (map.getLayer("kroeg-halo")) map.setFilter("kroeg-halo", ["==", ["get", "id"], state.selected ?? -1]);
  if (map.getLayer("kroeg-cirkel")) for (const [k, v] of Object.entries(cirkelStijl())) map.setPaintProperty("kroeg-cirkel", k, v);
  if (map.getLayer("kroeg-prijs")) map.setLayerZoomRange("kroeg-prijs", prijsZoom(), 24);
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
  const { data, error } = await sb.from("kroeg_kaart").select("*").eq("gemeente", stadNaam).eq("open", true).order("naam");
  if (error) { console.error(error); toast("Kroegen laden mislukt"); return; }
  state.kroegen = data;
  state.codes = maakCodes(data);
  if (kaartNaarStad && data.length) { kaartNaarStad = false; map.jumpTo({ center: stadCentrum(), zoom: STAD.zoom }); }
  koersen();
  kaartBijwerken();
  lichtkrant();
  hud(); // de bovenbalk rekent met de kroegen (stand, jouw index), dus ook bijwerken als die binnenkomen
}

// Midden van de stad: de mediaan van de kroegen, zodat losse kroegen in de dorpen eromheen het niet verschuiven
function stadCentrum() {
  if (stadNaam === STAD.naam || !state.kroegen.length) return STAD.centrum;
  return [mediaan(state.kroegen.map((k) => k.lon)), mediaan(state.kroegen.map((k) => k.lat))];
}

async function laadStad() {
  const { data } = await sb.from("stad_voortgang").select("*").order("gemeente");
  state.steden = data ?? [];
  state.stad = state.steden.find((s) => s.gemeente === stadNaam) ?? null;
  // De bewaarde stad doet niet (meer) mee: terug naar de pilotstad
  if (!state.stad && data?.length && stadNaam !== STAD.naam) return kiesStad(STAD.naam);
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

// Beursbord linksboven: de Pilsindex met het verschil met twaalf maanden terug, en hoeveel kroegen een prijs hebben.
// Op Mijn kaart: jouw index (mediaan van de kroegen waar je was) en hoeveel kroegen je hebt bezocht.
function hud() {
  const idx = state.koers.index;
  if (guinnessAan()) {
    const met = state.kroegen.filter((k) => soortIn(k.id));
    const pint = mediaan(met.map((k) => perPint(soortIn(k.id))).filter(Boolean));
    zetRing(state.kroegen.length ? Math.round((met.length / state.kroegen.length) * 100) : 0,
      `${met.length} ${met.length === 1 ? "kroeg schenkt" : "kroegen schenken"} Guinness`, "Guinness, pint", pint, null);
    return;
  }
  if (state.modus === "mijn") {
    const totaal = state.kroegen.length, mijn = state.kroegen.filter((k) => state.mijn.has(k.id));
    // De bekende prijs van elke kroeg waar je was, ook als hij nog op bevestiging wacht: je ziet je bijdrage meteen
    const eigen = mediaan(mijn.map((k) => prijsPer25(k)).filter(Boolean));
    zetRing(totaal ? Math.round((mijn.length / totaal) * 100) : 0, `${mijn.length} van ${totaal} kroegen bezocht`,
      "Jouw index", eigen, eigen && idx ? eigen - idx.nu : null);
    return;
  }
  const pct = state.kroegen.length ? Math.round((inKaart() / state.kroegen.length) * 100) : 0;
  zetRing(pct, `${stadNaam} in kaart`, "Pilsindex", idx?.nu, idx?.delta, idx?.pct);
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
  // In de koersstand staat de lijst op Goedkoopst
  if (m === "koers" && state.filter !== "goedkoop") { state.filter = "goedkoop"; if (state.tab === "kaart" && state.selected == null && !state.tocht && !bezigMetTypen()) draw(); }
  kaartBijwerken();
  hud();
  if (m === "mijn" && !state.sessie) toast("Check in bij een kroeg en hij komt op jouw kaart");
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
  else if (state.pagina === "regels") html = regelsView();
  else if (state.tocht) html = tochtView();
  else if (state.tab === "kaart") html = lijstView();
  else if (state.tab === "beurs") html = '<div class="empty">Laden…</div>';
  else if (state.tab === "rang") html = '<div class="empty">Laden…</div>';
  else if (state.tab === "ik") html = ikView();
  body.innerHTML = html;
  if (state.selected != null && !state.form && !state.aanbodForm && !state.tijdenForm) { laadTijdlijn(state.selected); laadKroegInfo(state.selected); }
  else if (state.selected == null && !state.pagina && state.tab === "beurs") beursView();
  else if (state.selected == null && !state.pagina && state.tab === "rang") rangView();
  else if (state.selected == null && !state.pagina && state.tab === "ik" && state.profiel?.is_beheerder) { laadBeheerMeldingen(); laadBeheerBugs(); laadBeheerSteden(); }
  if (state.selected == null && !state.pagina && state.tab === "ik" && state.sessie) laadBadges();
  // Een willekeurige naam van een anonieme speler (dorstige-zebra) past niet op het tabblad; die blijft Ik
  $("#tabIk").textContent = state.profiel && !anoniem() && state.profiel.naam_vast ? state.profiel.naam : "Ik";
}

// Een prijs die nog op bevestiging wacht (van een speler of van de menukaart) is blauw. Grijs is alleen
// een kroeg waar nog niemand de prijs van weet; elke andere kroeg is "in kaart" (inKaart()).
function kroegVersheid(k) {
  if (k.open_melding_id && !k.huidig_prijs_cent) return "wacht";
  return k.versheid;
}

// Hoeveel kroegen in kaart zijn: alle kroegen met een prijs in de app, bevestigd, van de menukaart of nog te bevestigen
const inKaart = (lijst = state.kroegen) => lijst.filter((k) => prijsPer25(k) != null).length;

function rowHtml(k) {
  const v = kroegVersheid(k);
  const d = state.pos ? Math.round(afstand(state.pos, [k.lon, k.lat])) : null;
  // Zoals in Aandelen: naam vet, daaronder de tickercode en de rest in grijs
  const sub = [codeVan(k.id), k.wijk, d != null ? meters(d) : null, v === "wacht" && !state.soort ? null : VERSHEID[v], state.mijn.has(k.id) ? "bezocht" : null].filter(Boolean).join(" · ");
  return `<li><button class="row" data-kroeg="${k.id}">
    <span class="dot ${v}"></span>
    <span class="row-main"><span class="row-title">${esc(k.naam)}</span><span class="row-sub">${esc(sub)}</span></span>
    ${state.soort ? "" : trapjeHtml(k.id)}${prijsKolom(k)}
  </button></li>`;
}

function prijsKolom(k) {
  if (state.soort) {
    const a = soortIn(k.id);
    return a?.prijs_cent ? `<span class="price">${euro(a.prijs_cent)}<small>${a.volume_cl === PINT ? "pint" : `${a.volume_cl} cl`}</small></span>` : `<span class="small muted">prijs?</span>`;
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
    { id: "goedkoop", naam: "Goedkoopst", f: (k) => prijsPer25(k) != null },
    { id: "slot", naam: "Nog geen prijs", f: (k) => prijsPer25(k) == null },
    // De klussen waarmee je punten verdient: een melding van een ander bevestigen of een oude prijs controleren
    { id: "controleren", naam: "Te controleren", f: (k) => (k.open_melding_id && !vanMenukaart(k)) || k.versheid === "old" },
    ...(state.sessie ? [{ id: "nieuw", naam: "Nog niet bezocht", f: (k) => !state.mijn.has(k.id) }] : []),
  ];
  const f = F.find((x) => x.id === state.filter) ?? F[0];
  const q = state.zoek.trim().toLowerCase();
  // Met een soort gekozen: "Goedkoopst" sorteert op de prijs van die soort; kroegen zonder prijs ervan achteraan
  const prijsVoor = (k) => state.soort ? (perPint(soortIn(k.id)) ?? Infinity) : prijsPer25(k);
  let rows = zichtbareKroegen()
    .filter((k) => state.soort && state.filter === "goedkoop" ? true : f.f(k))
    .filter((k) => !state.wijk || k.wijk === state.wijk)
    .filter((k) => !q || [k.naam, k.wijk, k.adres].some((x) => (x ?? "").toLowerCase().includes(q)));
  if (state.filter === "goedkoop" || (guinnessAan() && !state.pos)) rows.sort((a, b) => prijsVoor(a) - prijsVoor(b));
  else if (state.pos) rows.sort((a, b) => afstand(state.pos, [a.lon, a.lat]) - afstand(state.pos, [b.lon, b.lat]));
  // Zonder locatie: eerst de kroegen met een prijs (de lijst is anders vooral "Nog geen prijs"), daarna op naam
  else rows.sort((a, b) => (prijsPer25(a) == null) - (prijsPer25(b) == null));
  const leeg = state.kroegen.length === 0
    ? `<div class="empty">Nog geen kroegen geladen.<br><span class="small">Een beheerder importeert ze via het tabblad Ik.</span></div>`
    : state.soort ? `<div class="empty">Nog geen kroeg met Guinness gemeld.<br><span class="small">Weet je er een? Meld het bij de kroeg onder "Guinness".</span></div>`
    : state.filter === "controleren" && !q ? `<div class="empty">Niets te controleren.<br><span class="small">Geen meldingen die wachten en geen prijzen van 90 dagen of ouder.</span></div>`
    : `<div class="empty">Niets gevonden.<br><span class="small">Probeer een andere zoekterm of een ander filter.</span></div>`;
  const hint = !state.pos && state.filter !== "goedkoop"
    ? `<p class="small muted hint">Kroegen met een prijs eerst, daarna op naam.</p>` : "";
  // Zit je in een kroeg, dan is dit de eerste stap: met je locatie staat hij bovenaan
  const bijJou = state.pos ? "" : `<button class="row tocht-link" data-locatie-lijst><span class="ic-sm">${ICON_LOCATIE}</span><span class="row-main"><span class="row-title">Kroegen bij jou</span><span class="row-sub">Zit je in een kroeg? Zet hem bovenaan</span></span><span class="muted">›</span></button>`;
  const meer = rows.length - state.limiet;
  return `<input class="search" type="search" placeholder="Zoek een kroeg, wijk of straat" value="${esc(state.zoek)}" data-zoek>
    ${bijJou}
    <button class="row tocht-link" data-tocht-open><span class="ic-sm">${ICON_ROUTE}</span><span class="row-main"><span class="row-title">Plan een kroegentocht</span><span class="row-sub">Langs de goedkoopste kroegen of waar je nog niet was</span></span><span class="muted">›</span></button>
    <div class="chips">${state.wijk ? `<button class="chip" data-wis-wijk aria-pressed="true" aria-label="Filter ${esc(state.wijk)} wissen">${esc(state.wijk)} ✕</button>` : ""}${F.map((x) => `<button class="chip" data-filter="${x.id}" aria-pressed="${x.id === f.id}">${x.naam}</button>`).join("")}</div>
    ${guinnessAan() ? `<p class="small guinness-uitleg">Guinness-stand: alleen kroegen met Guinness, goedkoopste pint eerst. <button type="button" class="linkbtn" data-guinness-uit>Terug naar pils</button></p>` : ""}
    ${hint}
    ${rows.length ? `<div class="small muted telling">${rows.length === 1 ? "1 kroeg" : `${rows.length} kroegen`}</div><ul class="list">${rows.slice(0, state.limiet).map(rowHtml).join("")}</ul>
      ${meer > 0 ? `<div class="btns"><button type="button" class="btn" data-meer>Toon er nog ${Math.min(40, meer)} van ${meer}</button></div>` : ""}` : leeg}`;
}

// Vanuit Beurs een wijk aantikken: de lijst toont alleen die wijk en de kaart zoomt erop in
function kiesWijk(naam) {
  state.wijk = naam; state.filter = "alles"; state.limiet = 40;
  setTab("kaart");
  const ks = state.kroegen.filter((k) => k.wijk === naam);
  if (ks.length && kaartKlaar) {
    const b = ks.reduce((bb, k) => bb.extend([k.lon, k.lat]), new maplibregl.LngLatBounds([ks[0].lon, ks[0].lat], [ks[0].lon, ks[0].lat]));
    map.fitBounds(b, { padding: wide() ? { left: 440, top: 80, bottom: 40, right: 40 } : { top: 140, bottom: innerHeight * 0.5, left: 30, right: 30 }, maxZoom: 15.5, duration: 700 });
  }
}

function detailView() {
  const k = state.kroegen.find((x) => x.id === state.selected);
  if (!k) return `<button class="back" data-back>‹ Terug</button><div class="empty">Kroeg niet gevonden.</div>`;
  const v = kroegVersheid(k);
  let actie = "";
  if (!kanBijdragen()) {
    // Alleen als anoniem meespelen in Supabase uit staat: een weg naar een account. Daarna kom je hier terug.
    actie = `<div class="btns"><button class="btn primary" data-doe-mee>${k.versheid === "locked" ? "Doe mee en geef de eerste prijs door" : "Doe mee en houd de prijs bij"}</button></div>
      <div class="small muted" style="margin-top:8px">Je begint meteen, zonder wachtwoord. Daarna kom je terug bij deze kroeg.</div>`;
  } else {
    // Inchecken en de prijs doorgeven zijn een handeling: je zit in de kroeg, je hebt je pils en je checkt in met de prijs
    const vandaag = isVandaag(state.mijn.get(k.id)?.laatst);
    const d = state.pos ? afstand(state.pos, [k.lon, k.lat]) : null;
    const uitleg = vandaag ? "Je bent hier vandaag ingecheckt."
      : d != null && d > INCHECK_M ? `Je bent ${meters(d)} hiervandaan; inchecken kan binnen ${INCHECK_M} m.`
      : "Check in met de prijs van je pils.";
    actie = `${k.open_melding_id && !vanMenukaart(k) ? `<div class="card" id="openMelding"><div class="muted small">Melding laden…</div></div>` : ""}
      <div class="btns"><button class="btn primary" data-form="hier">${vandaag ? "Prijs doorgeven" : "Inchecken"}</button></div>
      <div class="small muted" style="margin-top:8px">${uitleg}${vandaag ? "" : ` <button type="button" class="linkbtn" data-form="afstand">Niet in de kroeg?</button>`}</div>`;
  }
  return `<button class="back" data-back>‹ Terug</button>
    <div class="koerskop">${codeHtml(k.id, true)}<span class="badge ${v}">${VERSHEID[v]}</span></div>
    <h2>${esc(k.naam)}</h2>
    <div class="muted small">${esc([k.adres, k.wijk].filter(Boolean).join(" · "))}</div>
    <div class="card">
      ${k.open_prijs_cent && vanMenukaart(k) ? `
        <div class="big-price">${euro(k.open_prijs_cent)}<span class="onbevestigd">?</span></div>
        <div class="muted">${glasTekst(k.open_merk, k.open_volume_cl, k.open_per25_cent)}</div>
        <div class="muted small">Van de menukaart</div>`
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
      : `<div class="big-price muted">€ ?</div><div class="muted" style="margin-top:6px">Nog geen koers. Check in en geef als eerste de prijs van een vaasje door.</div>`}
      ${k.ontdekker ? `<div class="small" style="margin-top:8px">Ontdekt door <b>${esc(k.ontdekker)}</b> ${wanneer(k.ontdekt_op)}</div>` : ""}
      ${actie}
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
  if (anoniem()) return `<div class="small muted">Met een account (tabblad Ik) kun je dit bevestigen.</div>`;
  return `<button class="mini" data-melding="${m.id}" data-oordeel-melding="klopt">Klopt</button><button class="mini" data-melding="${m.id}" data-oordeel-melding="klopt_niet">Klopt niet</button>`;
}

function tijdenBlok(info) {
  const tijden = info?.openingstijden;
  const melding = (info?.open_meldingen ?? []).find((m) => m.soort === "openingstijden");
  const vandaag = vandaagDag();
  const bron = !tijden ? "" : melding
    ? `Aangepast door <b>${esc(melding.door ?? "Onbekend")}</b> ${wanneer(melding.op)}${melding.klopt_niet ? " · 1 keer klopt niet" : ""}`
    : info.openingstijden_bron === "spelers" ? `Door spelers bijgewerkt ${wanneer(info.openingstijden_op)}` : "";
  return `<h3>Openingstijden</h3>
    ${tijden ? `<ul class="tijden">${DAGEN.map((d) => `<li class="${d === vandaag ? "vandaag" : ""}"><span>${d[0].toUpperCase() + d.slice(1)}</span><span>${tijdenTekst(tijden[d] ?? [])}</span></li>`).join("")}</ul>
      ${bron ? `<div class="small muted">${bron}</div>` : ""}
      ${melding ? `<div class="btns">${meldingKnoppen(melding)}</div>` : ""}`
    : `<div class="small muted">Nog geen openingstijden bekend.</div>`}
    ${melding ? "" : `<div class="btns"><button class="btn" data-tijdenform ${kanBijdragen() ? "" : "disabled"}>${tijden ? "Tijden kloppen niet" : "Tijden invullen"}</button></div>`}`;
}

// Klopt deze kroeg niet? Open meldingen bovenaan; daaronder een klein formulier voor een nieuwe melding.
const KROEGMELDING = {
  gesloten: { knop: "Definitief gesloten", wat: "meldt dat deze kroeg definitief gesloten is.", gevolg: "Na een bevestiging door een andere speler verdwijnt de kroeg van de kaart." },
  verkeerde_plek: { knop: "Staat op de verkeerde plek", wat: "meldt dat deze kroeg op de verkeerde plek op de kaart staat.", gevolg: "Na een bevestiging verplaatst een beheerder hem." },
  dubbel: { knop: "Staat er dubbel op", wat: "meldt dat deze kroeg dubbel op de kaart staat.", gevolg: "Na een bevestiging door een andere speler verdwijnt deze van de kaart. De andere blijft staan." },
};
function sluitingBlok(info) {
  const open = (info?.open_meldingen ?? []).filter((m) => KROEGMELDING[m.soort]);
  const kaarten = open.map((m) => `<div class="card">
      <div><b>${esc(m.door ?? "Iemand")}</b> ${KROEGMELDING[m.soort].wat}</div>
      ${m.toelichting ? `<div class="toelichting">"${esc(m.toelichting)}"</div>` : ""}
      <div class="small muted">Gemeld ${wanneer(m.op)}${m.klopt_niet ? ", 1 keer klopt niet" : ""}. ${KROEGMELDING[m.soort].gevolg}</div>
      <div class="btns">${meldingKnoppen(m)}</div></div>`).join("");
  const vrij = Object.keys(KROEGMELDING).filter((soort) => !open.some((m) => m.soort === soort));
  const formulier = !kanBijdragen() || !vrij.length ? "" : `<details class="klopt-niet">
      <summary>Klopt deze kroeg niet?</summary>
      <form class="form" id="kroegmeldingForm">
        <div class="seg">${vrij.map((soort, i) => `<label class="keuze"><input type="radio" name="soort" value="${soort}" ${i ? "" : "checked"}> ${KROEGMELDING[soort].knop}</label>`).join("")}</div>
        <label for="kmToelichting">Toelichting (optioneel)</label>
        <input id="kmToelichting" name="toelichting" maxlength="280" placeholder="Bijvoorbeeld: zit aan de overkant, of: zelfde als Café De Fuik">
        <div class="btns"><button class="btn" type="submit">Melden</button></div>
        <p class="small muted">Geen punten. Een andere speler met e-mailadres bevestigt het. De prijs zelf pas je hierboven aan.</p>
      </form></details>`;
  return kaarten + formulier;
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
  if (!(await zorgVoorSpeler())) { knop.disabled = false; return; }
  const { error } = await sb.rpc("meld_kroeg", { p_kroeg_id: k.id, p_soort: "openingstijden", p_openingstijden: tijden });
  knop.disabled = false;
  if (error) return toast(await leesFout(error));
  state.tijdenForm = null;
  toast("Openingstijden bijgewerkt, bedankt");
  draw();
}

async function verstuurKroegmelding(form) {
  const k = state.kroegen.find((x) => x.id === state.selected);
  const fd = new FormData(form);
  const soort = String(fd.get("soort")), toelichting = String(fd.get("toelichting") ?? "").trim();
  if (toelichting && toelichting.length < 2) return toast("Maak de toelichting iets langer, of laat hem leeg");
  if (soort !== "verkeerde_plek" && !(await vraag(`${KROEGMELDING[soort].knop}: ${k.naam}? ${KROEGMELDING[soort].gevolg}`, "Melden"))) return;
  const knop = form.querySelector("button[type=submit]"); knop.disabled = true;
  if (!(await zorgVoorSpeler())) { knop.disabled = false; return; }
  const { error } = await sb.rpc("meld_kroeg", { p_kroeg_id: k.id, p_soort: soort, p_toelichting: toelichting || null });
  knop.disabled = false;
  if (error) return toast(await leesFout(error));
  toast("Gemeld; een andere speler moet het bevestigen");
  draw();
}

async function beoordeelMelding(id, oordeel) {
  const { data, error } = await sb.rpc("beoordeel_kroegmelding", { p_melding_id: id, p_oordeel: oordeel });
  if (error) return toast(await leesFout(error));
  toast(data === "bevestigd" ? "Bevestigd, bedankt" : data === "weerlegd" ? "Weggehaald" : "Genoteerd; nog een keer klopt niet en het wordt teruggedraaid");
  // Een bevestigde sluiting of dubbele kroeg haalt de kroeg van de kaart
  if (data === "bevestigd" && (state.info?.open_meldingen ?? []).some((m) => m.id === id && (m.soort === "gesloten" || m.soort === "dubbel"))) {
    await laadKroegen();
    return sluitKroeg();
  }
  draw();
}

// Mijn kroegen: persoonlijk, los van de gezamenlijke mist. Inchecken zelf zit in de knop Inchecken van de kroeg.
function incheckHtml(k) {
  const m = state.mijn.get(k.id);
  if (!m) return "";
  return `<div class="card incheck bezocht">
    <span class="ic">${ICON_PIN}</span>
    <div><div class="t">Mijn kroegen</div><div>Je was hier ${keer(m.keer)}, ${isVandaag(m.laatst) ? "vandaag nog" : `laatst ${wanneer(m.laatst)}`}.</div></div>
  </div>`;
}

// Guinness bij een kroeg: het enige extra bier in de app. Geen punten, wel bevestigen ("klopt") of afkeuren ("klopt niet").
function aanbodBlok(k) {
  const a = aanbodVan(k.id).find((x) => x.soort === GUINNESS);
  const uid = state.sessie?.user?.id;
  const knoppen = !a || !state.sessie ? ""
    : a.door_id === uid ? `<button class="mini" data-aanbod="${a.id}" data-oordeel-aanbod="klopt_niet">Intrekken</button>`
    : anoniem() ? ""
    : `<button class="mini" data-aanbod="${a.id}" data-oordeel-aanbod="klopt">Klopt</button><button class="mini" data-aanbod="${a.id}" data-oordeel-aanbod="klopt_niet">Klopt niet</button>`;
  return `<h3>Guinness</h3>
    ${a ? `<div class="aanbod">
      <div class="aanbod-main"><b>Guinness van de tap</b>${a.volume_cl ? ` <span class="muted">${a.volume_cl === PINT ? "pint" : `${a.volume_cl} cl`}</span>` : ""}
        <div class="small muted">${esc(a.door ?? "Onbekend")}, ${wanneer(a.gecontroleerd_op ?? a.op)}${a.klopt_niet ? " · 1 keer klopt niet" : ""}</div></div>
      ${a.prijs_cent ? `<span class="price">${euro(a.prijs_cent)}</span>` : `<span class="small muted">prijs?</span>`}
      <div class="aanbod-knoppen">${knoppen}</div>
    </div>
    ${a.prijs_cent ? "" : `<div class="btns"><button class="btn" data-aanbodform ${kanBijdragen() ? "" : "disabled"}>Prijs van een pint melden</button></div>`}`
    : `<div class="small muted">Nog niet bekend of ze hier Guinness tappen.</div>
    ${kanBijdragen() ? `<div class="btns"><button class="btn" data-aanbodform>Ze hebben hier Guinness</button></div>` : ""}`}`;
}

function aanbodFormView() {
  const k = state.kroegen.find((x) => x.id === state.selected);
  const f = state.aanbodForm;
  const GLAS = [[PINT, "Pint", "50 cl"], [25, "Halve pint", "25 cl"], [0, "Ander glas", "zelf invullen"]];
  return `<button class="back" data-cancel>‹ Annuleer</button>
    <h2>Guinness</h2>
    <div class="muted small">${esc(k.naam)}</div>
    <form class="form" id="aanbodForm">
      <input type="hidden" name="soort" value="${GUINNESS}">
      <label>Glas</label>
      <div class="seg">${GLAS.map(([cl, naam, sub]) => `<button type="button" data-glas-guinness="${cl || "anders"}" aria-pressed="${(f.cl ?? 0) === cl}">${naam}<br><span class="small muted">${sub}</span></button>`).join("")}</div>
      <input name="cl" inputmode="numeric" placeholder="Inhoud in cl, bijvoorbeeld 57" style="margin-top:6px" ${f.cl ? "hidden" : ""}>
      <label>Prijs in euro (optioneel)</label>
      <input name="prijs" inputmode="decimal" placeholder="6,50">
      <div class="btns"><button class="btn primary" type="submit">Opslaan</button></div>
      <p class="small muted">Weet je de prijs niet, meld dan toch dat ze Guinness hebben: dan staat de kroeg in de Guinness-stand. Guinness levert geen punten op.</p>
    </form>`;
}

async function verstuurAanbod(form) {
  const k = state.kroegen.find((x) => x.id === state.selected);
  const fd = new FormData(form);
  const merk = String(fd.get("merk") ?? "").trim();
  const clTekst = state.aanbodForm?.cl ? String(state.aanbodForm.cl) : String(fd.get("cl") ?? "").trim();
  const prijsTekst = String(fd.get("prijs") ?? "").trim();
  const cl = clTekst ? Math.round(Number(clTekst.replace(",", "."))) : null;
  const prijs = prijsTekst ? Math.round(parseFloat(prijsTekst.replace(",", ".")) * 100) : null;
  if (merk && merk.length < 2) return toast("Vul een merk van minstens 2 tekens in, of laat het leeg");
  if (cl != null && (!Number.isFinite(cl) || cl < 15 || cl > 100)) return toast("Vul een glas tussen 15 en 100 cl in");
  if (prijs != null && (!Number.isFinite(prijs) || prijs < 50 || prijs > 2500)) return toast("Vul een prijs tussen €0,50 en €25 in");
  if (prijs != null && cl == null) return toast("Vul bij een prijs ook het glas in");
  const knop = form.querySelector("button[type=submit]"); knop.disabled = true;
  if (!(await zorgVoorSpeler())) { knop.disabled = false; return; }
  const { error } = await sb.rpc("meld_aanbod", { p_kroeg_id: k.id, p_soort: String(fd.get("soort")), p_merk: merk || null, p_volume_cl: cl, p_prijs_cent: prijs });
  knop.disabled = false;
  if (error) return toast(await leesFout(error));
  state.aanbodForm = null;
  toast("Opgeslagen, bedankt");
  await laadAanbod();
  draw();
}

async function beoordeelAanbod(id, oordeel) {
  const { data, error } = await sb.rpc("beoordeel_aanbod", { p_aanbod_id: id, p_oordeel: oordeel });
  if (error) return toast(await leesFout(error));
  toast(data === "weg" ? "Weggehaald" : oordeel === "klopt" ? "Bedankt voor het controleren" : "Genoteerd; nog een keer klopt niet en het verdwijnt");
  await laadAanbod();
  draw();
}

async function laadAanbod() {
  const [{ data: aanbod, error }, soorten] = await Promise.all([
    sb.from("aanbod_overzicht").select("*").eq("gemeente", stadNaam),
    state.biersoorten.length ? { data: state.biersoorten } : sb.from("biersoorten").select("*").order("volgorde"),
  ]);
  // Bestaat de tabel nog niet (migratie nog niet uitgevoerd), dan blijft de app gewoon werken zonder extra's
  if (error) return;
  // Voorlopig alleen Guinness; ander extra bier blijft in de database maar staat niet in de app
  state.aanbod = (aanbod ?? []).filter((a) => a.soort === GUINNESS);
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
  // Intussen een formulier geopend: dan staat de tijdlijn niet in beeld
  if (state.selected !== id || !$("#tijdlijn")) return;
  if (error) { $("#tijdlijn").innerHTML = `<div class="muted small">Laden mislukt.</div>`; return; }
  $("#stamgast").innerHTML = data.length && !bijdragersFout ? stamgastHtml(bijdragers ?? [], uid) : "";
  const open = data.find((g) => g.status === "wacht");
  const el = $("#openMelding");
  if (el && open) {
    const eigen = open.door_id === uid;
    const al = state.profiel && [...open.bevestigd_door, ...open.weerlegd_door].includes(state.profiel.naam);
    el.innerHTML = `<div><b>${esc(open.door)}</b> meldt ${euro(open.prijs_cent)} voor ${esc(open.merk)} ${open.volume_cl} cl</div>
      <div class="muted small">${wanneer(open.op)}${open.ter_plaatse ? " · ter plaatse" : ""}${open.uitschieter ? " · wijkt sterk af, twee bevestigingen nodig" : ""}</div>
      ${open.foto_pad ? `<div class="small"><button type="button" class="linkbtn" data-foto="${esc(fotoUrl(open.foto_pad))}">Foto van de prijslijst</button></div>` : ""}
      ${eigen ? `<div class="small muted" style="margin-top:8px">Wacht op bevestiging door andere spelers.</div>`
        : al ? `<div class="small muted" style="margin-top:8px">Je hebt deze melding al beoordeeld.</div>`
        : !magControleren() ? `<div class="small muted" style="margin-top:8px">Met een account (tabblad Ik) kun je meldingen van anderen bevestigen.</div>`
        : `<div class="btns"><button class="btn good" data-oordeel="klopt" data-g="${open.id}">Klopt</button>
             <button class="btn bad" data-oordeel="klopt_niet" data-g="${open.id}">Klopt niet</button></div>`}`;
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
      <div class="t-meta">${datumTekst(g.op)} · ${esc(bronKort(g.bron_omschrijving))} · ${esc(g.merk)} ${g.volume_cl} cl</div></li>`;
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
    ${g.foto_pad ? `<div class="t-meta"><button type="button" class="linkbtn" data-foto="${esc(fotoUrl(g.foto_pad))}">Foto van de prijslijst</button></div>` : ""}</li>`;
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
  const maand = (t) => new Date(t).toLocaleDateString(LOCALE, { month: "short", year: "2-digit" }).replace(".", "");
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

// De prijs die er nu staat: een openstaande melding of menukaartprijs gaat voor de bevestigde prijs
function bekendePrijs(k) {
  if (k.open_prijs_cent) return { merk: k.open_merk, cl: k.open_volume_cl, prijs: k.open_prijs_cent, per25: k.open_per25_cent, soort: vanMenukaart(k) ? "menukaart" : "melding" };
  if (k.huidig_prijs_cent) return { merk: k.huidig_merk, cl: k.huidig_volume_cl, prijs: k.huidig_prijs_cent, per25: k.per25_cent, soort: "huidig" };
  return null;
}
// Kan de speler met een tik zeggen dat de bekende prijs klopt? Van afstand alleen met een account, en nooit voor de menukaart.
const snelKlopt = (b, hier) => !!b && (hier || (b.soort !== "menukaart" && magControleren()));

function formView() {
  const k = state.kroegen.find((x) => x.id === state.selected);
  const f = state.form;
  const b = bekendePrijs(k);
  const vandaag = isVandaag(state.mijn.get(k.id)?.laatst);
  const titel = f.hier ? (vandaag ? "Prijs doorgeven" : "Inchecken") : "Prijs doorgeven";
  const zonder = f.hier && !vandaag ? `<p class="small"><button type="button" class="linkbtn" data-incheck="zonder">Inchecken zonder prijs</button></p>` : "";
  const locatieTekst = f.hier ? `<p class="small muted">We kijken of je binnen ${INCHECK_M} m van de kroeg bent en bewaren alleen die afstand. Ter plaatse tellen je punten 1,5 keer.</p>` : "";
  if (snelKlopt(b, f.hier) && !f.anders) {
    return `<button class="back" data-cancel>‹ Annuleer</button>
    <h2>${titel}</h2>
    <div class="muted small">${esc(k.naam)}</div>
    <p>${f.hier ? "Wat kost je pils hier?" : "Klopt deze prijs nog?"}</p>
    <form class="form" id="prijsForm">
      <div class="big-price">${euro(b.prijs)}</div>
      <div class="muted">${glasTekst(b.merk, b.cl, b.per25)}</div>
      <div class="btns"><button type="button" class="btn primary" data-incheck="klopt">Klopt</button>
        <button type="button" class="btn" data-andere-prijs>Andere prijs</button></div>
      ${zonder}
      ${locatieTekst}
    </form>`;
  }
  return `<button class="back" data-cancel>‹ Annuleer</button>
    <h2>${titel}</h2>
    <div class="muted small">${esc(k.naam)}</div>
    <form class="form" id="prijsForm">
      <label>Wat kost je pils? In euro</label>
      <input name="prijs" inputmode="decimal" placeholder="3,50" required value="${esc(f.prijs ?? "")}">
      <p class="small muted" id="prijsVoorbeeld" aria-live="polite">Vul de prijs in. Je ziet meteen wat dat per vaasje is.</p>
      <label>Glas</label>
      <div class="seg">${GLAZEN.map((g) => `<button type="button" data-cl="${g.cl}" aria-pressed="${!f.clAnders && g.cl === f.cl}">${g.naam}<br><span class="small muted">${g.cl} cl</span></button>`).join("")}
        <button type="button" data-cl="anders" aria-pressed="${!!f.clAnders}">Ander glas<br><span class="small muted">zelf invullen</span></button></div>
      <input name="clAnders" type="number" min="15" max="100" inputmode="numeric" placeholder="Inhoud in cl, bijvoorbeeld 28" style="margin-top:6px" ${f.clAnders ? "" : "hidden"} value="${f.clAnders ? esc(f.cl) : ""}">
      <p class="small muted">Geen vaasje? Kies het kleinste glas, we rekenen om naar een vaasje.</p>
      <label>Merk pils</label>
      <select name="merk">${MERKEN.map((m) => `<option ${m === f.merk ? "selected" : ""}>${m}</option>`).join("")}<option value="_anders" ${MERKEN.includes(f.merk) ? "" : "selected"}>Anders…</option></select>
      <input name="merkAnders" placeholder="Ander merk" style="margin-top:6px;${MERKEN.includes(f.merk) ? "display:none" : ""}" value="${MERKEN.includes(f.merk) ? "" : esc(f.merk)}">
      <label>Foto van de prijslijst (optioneel, +5)</label>
      <label class="btn fotoknop"><input name="foto" type="file" accept="image/*" capture="environment"><span id="fotoNaam">Foto maken of kiezen</span></label>
      <img class="foto-voorbeeld" id="fotoVoorbeeld" alt="Voorbeeld van je foto" hidden>
      <div class="btns"><button class="btn primary" type="submit" id="verstuur">${f.hier && !vandaag ? "Inchecken" : "Versturen"}</button></div>
      ${zonder}
      ${locatieTekst}
      <p class="small muted">Je krijgt de punten meteen. Wordt je melding weerlegd, dan gaan ze er weer af.</p>
    </form>`;
}

// Het gekozen glas in cl; bij "Ander glas" wat de speler invult (15 tot 100 cl, net als de database)
function gekozenCl() {
  if (!state.form) return null;
  if (!state.form.clAnders) return state.form.cl;
  const n = Math.round(Number(body.querySelector("[name=clAnders]")?.value));
  return n >= 15 && n <= 100 ? n : null;
}

// Onder de prijs: wat het per vaasje is, naast de Pilsindex, en of het een uitschieter wordt
function prijsVoorbeeld() {
  const el = $("#prijsVoorbeeld"), form = $("#prijsForm");
  if (!el || !form) return;
  const prijs = Math.round(parseFloat(String(new FormData(form).get("prijs") ?? "").replace(",", ".")) * 100);
  const cl = gekozenCl();
  if (!Number.isFinite(prijs) || prijs <= 0 || !cl) {
    el.className = "small muted";
    el.textContent = cl ? "Vul de prijs in. Je ziet meteen wat dat per vaasje is." : "Vul de inhoud van het glas in, tussen 15 en 100 cl.";
    return;
  }
  const per25 = Math.round((prijs * 25) / cl), idx = state.koers.index?.nu;
  // Zelfde grens als de database: meer dan 40% van de mediaan, vanaf 5 prijzen in de stad
  const med = state.stad?.mediaan_per25_cent, genoeg = state.koers.punten.size >= 5;
  const uitschieter = med && genoeg && Math.abs(per25 - med) > med * 0.4;
  el.className = uitschieter ? "small waarschuwing" : "small muted";
  el.textContent = (cl === VAASJE ? `${euro(prijs)} voor een vaasje.` : `${euro(prijs)} voor ${cl} cl is ${euro(per25)} per vaasje.`)
    + (idx ? ` De Pilsindex is ${euro(idx)}.` : "")
    + (uitschieter ? " Dit wijkt sterk af van de stad: twee andere spelers moeten het bevestigen." : "");
}

// Een foto van de telefoon is vaak 4 tot 12 MB. Verklein hem naar hoogstens 1600 px als JPEG: sneller en zuiniger.
async function verkleinFoto(file) {
  if (!file?.type?.startsWith("image/") || /heic|heif/i.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const schaal = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * schaal));
    c.height = Math.max(1, Math.round(bmp.height * schaal));
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.82));
    return blob && blob.size < file.size ? new File([blob], "prijslijst.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

async function beursView() {
  const [{ data: wijken }, { data: recent }] = await Promise.all([
    sb.from("wijk_voortgang").select("*").eq("gemeente", stadNaam).order("naam"),
    sb.from("kroeg_tijdlijn").select("id,kroeg_id,kroeg,soort,status,door,op,prijs_cent,vorige_prijs_cent,volume_cl").eq("bron", "speler").eq("gemeente", stadNaam).order("op", { ascending: false }).limit(15),
  ]);
  if (state.tab !== "beurs" || state.selected != null || state.pagina) return;
  const s = state.stad ?? { vers: 0, oud: 0, bijdragen_week: 0, spelers_week: 0 };
  // Dezelfde telling als op de kaart en in de lichtkrant: elke kroeg met een prijs
  const totaal = state.kroegen.length, metPrijs = inKaart();
  const pct = totaal ? Math.round((metPrijs / totaal) * 100) : 0;
  const MS = [25, 50, 75, 100], next = MS.find((m) => m > pct), nodig = next ? Math.ceil((next / 100) * totaal) - metPrijs : 0;
  const C = 2 * Math.PI * 42;
  const versPct = metPrijs ? Math.round((s.vers / metPrijs) * 100) : 0;
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
    const wi = inKaart(state.kroegen.filter((k) => k.wijk === w.naam));
    return `<button type="button" class="sector" data-wijk="${esc(w.naam)}" aria-label="${esc(w.naam)} op de kaart tonen">
      <div class="t"><b>${esc(w.naam)}</b><span>${m ? `<span class="price">${euro(m)}</span>` : `<span class="small muted">geen koers</span>`}</span></div>
      <div class="t small muted"><span>${wi} van ${w.kroegen} in kaart</span><span>${m && idx ? deltaHtml(m - idx.nu) + " t.o.v. index" : ""}</span></div>
      <div class="bar"><span style="width:${w.kroegen ? (wi / w.kroegen) * 100 : 0}%"></span></div></button>`;
  };

  const melding = (g) => {
    const per25 = g.volume_cl ? Math.round((g.prijs_cent * 25) / g.volume_cl) : null;
    const verschil = g.soort === "wijziging" && g.vorige_prijs_cent != null ? g.prijs_cent - g.vorige_prijs_cent : null;
    return `<li><button class="row" data-kroeg="${g.kroeg_id}">
      <span class="row-main"><span class="row-title">${codeHtml(g.kroeg_id)}${esc(g.door ?? "Iemand")} ${g.soort === "eerst" ? "ontdekte" : g.soort === "wijziging" ? "wijzigde" : "controleerde"} ${esc(g.kroeg)}</span>
      <span class="row-sub">${wanneer(g.op)}${g.status === "wacht" ? " · wacht op bevestiging" : g.status === "weerlegd" ? " · weerlegd" : ""}</span></span>
      ${g.soort !== "check" && per25 ? `<span class="price">${euro(g.prijs_cent)}${verschil ? `<small class="delta ${richting(verschil)}">${KOERS_TAAL[richting(verschil)]} ${bedrag(verschil)}</small>` : `<small>${g.volume_cl} cl</small>`}</span>` : ""}</button></li>`;
  };

  body.innerHTML = `
    <div class="indexkaart">
      <div class="kop">Pilsindex ${esc(stadNaam)}<span>${idx ? `${idx.n} ${idx.n === 1 ? "kroeg" : "kroegen"}` : ""}</span></div>
      ${idx ? `<div class="stand"><span class="big-price">${euro(idx.nu)}</span>${idx.delta != null ? `${deltaHtml(idx.delta, { pct: idx.pct, pil: true })}<span class="uitleg">in 12 maanden</span>` : ""}</div>
        <div class="uitleg">Wat een vaasje pils in ${esc(stadNaam)} kost: de middelste van de laatst bekende prijzen. Bierprijzen gaan meestal een keer per jaar omhoog, daarom vergelijken we met een jaar terug.</div>
        ${metPrijs > idx.n ? `<div class="uitleg">Van de ${metPrijs} kroegen met een prijs tellen er ${idx.n} mee. Een nieuwe melding telt mee zodra een andere speler hem bevestigt.</div>` : ""}
        ${idx.reeks.length > 1 ? `<div class="grafiek">${grafiekSvg(idx.reeks, { id: "gi", lijnLabel: "", kleur: idx.delta > 0 ? "var(--op)" : idx.delta < 0 ? "var(--af)" : "var(--accent)" })}</div>` : ""}`
      : `<div class="stand"><span class="big-price">€ ?</span></div>
        <div class="uitleg">Nog geen koers. Geef de eerste prijs door en zet de Pilsindex op het bord.</div>`}
    </div>
    <div class="small muted">↗ duurder · ↘ goedkoper · → vast. Rood en groen zoals jij het als klant voelt.</div>
    ${duo}
    <h3>Samen in kaart <span class="muted">${metPrijs}/${totaal}</span></h3>
    <div class="card ring-big">
      <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" class="ring-bg"/><circle cx="50" cy="50" r="42" class="ring-fg" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - pct / 100)}"/></svg>
      <div><div class="pct">${pct}%</div><div>van ${esc(stadNaam)} heeft een prijs</div>
      <div class="small muted">${metPrijs} van ${totaal} kroegen${next ? ` · nog ${nodig} tot ${next}%` : " · alles in kaart!"}</div></div>
    </div>
    <div class="milestones">${MS.map((m) => `<span class="${pct >= m ? "done" : ""}">${m}%</span>`).join("")}</div>
    <h3>Deze week, met z'n allen</h3>
    <div class="card">
      <div><b class="num">${s.bijdragen_week}</b> van ${WEEKDOEL} bijdragen <span class="muted small">· ${s.spelers_week} spelers</span></div>
      <div class="bar"><span style="width:${Math.min(100, (s.bijdragen_week / WEEKDOEL) * 100)}%"></span></div>
      ${s.oud ? `<div style="margin-top:12px"><b class="num">${s.oud}</b> oude koersen (90+ dagen) om te controleren <span class="muted small">· +15 per controle</span></div>` : ""}
      <div style="margin-top:12px"><b class="num">${versPct}%</b> van de prijzen is vers</div>
      <div class="bar fresh"><span style="width:${versPct}%"></span></div>
    </div>
    <h3>Sectoren <span class="muted">tik voor de kaart</span></h3>
    ${(wijken ?? []).length ? `<div class="card" style="padding:4px 14px">${(wijken ?? []).map(sector).join("")}</div>` : `<div class="muted small">Nog geen wijken geladen.</div>`}
    <h3>Laatste meldingen</h3>
    ${(recent ?? []).length ? `<ul class="list">${recent.map(melding).join("")}</ul>` : `<div class="muted small">Nog geen activiteit.</div>`}`;
}

async function rangView() {
  const kolom = state.periode;
  const { data } = await sb.from("ranglijst").select("*").gt(kolom, 0).order(kolom, { ascending: false }).limit(50);
  if (state.tab !== "rang" || state.selected != null || state.pagina) return;
  const uid = state.sessie?.user?.id;
  const P = [["week", "Week"], ["maand", "Maand"], ["altijd", "Altijd"]];
  body.innerHTML = `<h2>Koersmakers</h2><p class="muted small" style="margin-top:0">Wie de koers het best bijhoudt. Punten voor melden en controleren, nooit voor drinken. <button type="button" class="linkbtn" data-regels>Hoe punten werken</button></p>
    <div class="chips">${P.map(([id, n]) => `<button class="chip" data-periode="${id}" aria-pressed="${id === kolom}">${n}</button>`).join("")}</div>
    ${(data ?? []).length ? `<ul class="list">${data.map((r, i) => `<li class="row ${r.id === uid ? "me" : ""}">
      <span class="rank">${i + 1}</span>
      <span class="row-main"><span class="row-title">${esc(r.naam)}</span><span class="row-sub">${r.ontdekt} ontdekt · ${esc(betrouwTekst(r))}</span></span>
      <span class="price">${r[kolom]}<small>punten</small></span></li>`).join("")}</ul>` : `<div class="empty">Nog niemand heeft punten in deze periode.</div>`}`;
}

const LOGO = {
  apple: `<svg class="logo" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.37 12.6c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.47.83-.72 0-1.82-.81-3-.79-1.54.02-2.96.9-3.76 2.28-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74 1.38 0 1.77.74 2.98.72 1.23-.02 2.01-1.12 2.76-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.4-.92-2.42-3.66zM14.1 5.86c.63-.77 1.06-1.83.94-2.89-.91.04-2.01.61-2.66 1.37-.58.67-1.09 1.75-.96 2.79 1.02.08 2.05-.52 2.68-1.27z"/></svg>`,
  google: `<svg class="logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.27c0-.82-.07-1.6-.2-2.36H12v4.47h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.56-5.17 3.56-8.73z"/><path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.29 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.28a12 12 0 0 0 0 10.8l4.01-3.1z"/><path fill="#EA4335" d="M12 4.75c1.76 0 3.34.6 4.58 1.8l3.44-3.44A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.28 6.6l4.01 3.1C6.23 6.86 8.88 4.75 12 4.75z"/></svg>`,
};

// Knoppen voor Apple en Google. Zolang een aanbieder in Supabase uit staat, staat de knop op slot
// (zie docs/inloggen-met-apple-en-google.md). "koppelen": een anonieme speler maakt er een account van, met
// behoud van punten en check-ins. "inloggen": met een bestaand account.
function aanbiederKnoppen(soort = "inloggen") {
  // Alleen aanbieders die in Supabase aanstaan; een knop die nog niet werkt, verwart alleen
  const werkwoord = soort === "koppelen" ? "Account maken met" : "Doorgaan met";
  const knoppen = [["apple", "Apple"], ["google", "Google"]].filter(([id]) => state.aanbieders[id])
    .map(([id, naam]) => `<button class="btn aanbieder" data-aanbieder="${id}" data-soort="${soort}">${LOGO[id]}<span class="naam">${werkwoord} ${naam}</span></button>`);
  return knoppen.length ? `<div class="sociaal">${knoppen.join("")}</div>` : "";
}

async function inloggenMet(aanbieder, knop) {
  const koppelen = knop.dataset.soort === "koppelen" && (anoniem() || !state.sessie);
  if (!koppelen) onthoudAnoniem();
  if (koppelen && !(await zorgVoorSpeler())) return;
  knop.disabled = true;
  const terug = location.origin + location.pathname;
  // De pagina gaat naar Apple of Google en komt terug met ?code=; supabase-js wisselt die zelf in
  const { error } = koppelen
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

// Bewaarkopie van de sessie in een HttpOnly-cookie (app/_worker.js op Cloudflare Pages). Wist de browser zijn
// opslag (Safari na 7 dagen zonder bezoek, of de speler zelf), dan haalt de app de sessie daarmee terug. Ook een
// anonieme speler komt zo terug. Lokaal (zonder Cloudflare) mislukt dit stil.
const bewaar = {
  zet(sessie) {
    fetch("/api/sessie", sessie
      ? { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: sessie.refresh_token }), keepalive: true }
      : { method: "DELETE", keepalive: true }).catch(() => {});
  },
  async herstel() {
    try {
      const r = await fetch("/api/sessie", { method: "POST" });
      if (!r.ok) return null;
      const s = await r.json();
      if (!s?.access_token || !s.refresh_token) return null;
      const { data, error } = await sb.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
      return error ? null : data.session;
    } catch { return null; }
  },
};

// Speelt de speler zonder e-mailadres (anoniem account van Supabase)?
function anoniem() {
  return !!state.sessie?.user?.is_anonymous;
}
// Kan deze bezoeker bijdragen? Met een sessie, of zonder: dan maakt de eerste bijdrage een anoniem account.
const kanAnoniem = () => state.aanbieders.anoniem && !state.anoniemMislukt;
const kanBijdragen = () => !!state.sessie || kanAnoniem();
// Het werk van anderen controleren kan alleen met een account (private.vereis_email())
const magControleren = () => !!state.sessie && !anoniem();

// Inloggen met een ander, bestaand account vanuit een anonieme speler: zijn bijdragen gaan mee. Vlak voor het
// inloggen bewaren we het toegangstoken van de anonieme speler; na het inloggen zet de Edge Function samenvoegen
// alles over naar het account (private.voeg_samen) en verwijdert ze de anonieme speler.
const SAMEN = "bierkoers-samenvoegen";
function onthoudAnoniem() {
  if (!anoniem()) return;
  try { localStorage.setItem(SAMEN, JSON.stringify({ id: state.sessie.user.id, token: state.sessie.access_token })); } catch { /* privévenster */ }
}
async function samenvoegen(id) {
  let van = null;
  try { van = JSON.parse(localStorage.getItem(SAMEN) ?? "null"); localStorage.removeItem(SAMEN); } catch { return; }
  if (!van?.token || van.id === id) return;
  const { data, error } = await sb.functions.invoke("samenvoegen", { body: { anoniem_token: van.token } });
  if (error) return toast(await leesFout(error));
  if (data?.samengevoegd && (data.meldingen || data.punten || data.checkins)) {
    toast("Je bijdragen zonder account staan nu onder je account");
    vernieuw();
  }
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

// Account maken en inloggen. Een anonieme speler (of iemand zonder bijdragen) maakt een account: hetzelfde
// account krijgt een e-mailadres of Google, dus punten en check-ins blijven staan. Daarna kiest hij een eigen naam.
// Een scheiding "of" alleen als er iets achter staat
const metOf = (html, woord) => html ? `<div class="of">${woord}</div>${html}` : "";

function accountBlok(p) {
  if (state.inlog) return codeFormulier(state.inlog.soort === "koppelen" ? "Account maken" : "Inloggen");
  const email = onthouden.lees().email ?? "";
  return `<h3>Inloggen of account maken</h3>
    <div class="card">
      ${p ? `<div class="small">Je speelt nu als <b>${esc(p.naam)}</b>.</div><div class="small">Je punten en check-ins gaan mee, en met een account kun je prijzen van anderen bevestigen.</div>` : ""}
      <form class="form" id="loginForm">
        <label>E-mailadres</label><input name="email" type="email" autocomplete="email" value="${esc(email)}" required>
        <div class="btns"><button class="btn primary" type="submit">Ga verder</button></div>
      </form>
      <div class="small muted" style="margin-top:8px">Je krijgt een code per mail, geen wachtwoord. Hoort er nog geen account bij je e-mailadres, dan maken we er een.</div>
      ${metOf(aanbiederKnoppen(p ? "koppelen" : "inloggen"), "of")}
    </div>`;
}

function ikView() {
  if (!state.sessie && state.inlog) {
    return `<h2>Vul je code in</h2>${codeFormulier("Inloggen")}`;
  }
  // Inloggen met een onbekend e-mailadres: bied meteen een account aan in plaats van een weigering. Dat wordt
  // het anonieme account (nieuw, of het bestaande met punten), gekoppeld aan dit e-mailadres.
  if (state.nieuwAdres && (!state.sessie || anoniem())) {
    return `<h2>Nieuw account</h2>
      <p class="muted">Bij <strong>${esc(state.nieuwAdres)}</strong> hoort nog geen account. Maak er een: je krijgt een code per mail en kiest daarna je eigen spelersnaam.${state.sessie ? " Je punten en check-ins gaan mee." : ""}</p>
      <form class="form" id="nieuwForm">
        <div class="btns"><button class="btn primary" type="submit">Maak account en stuur code</button></div>
      </form>
      <div class="btns"><button class="btn" data-anderadres>Ander e-mailadres</button></div>`;
  }
  // Nog niets bijgedragen: nog geen account. Je speelt mee vanaf je eerste bijdrage, of je maakt hier meteen een account.
  if (!state.sessie && kanAnoniem()) {
    const terug = !!onthouden.lees().email;
    return `<h2>${terug ? "Welkom terug" : "Ik"}</h2>
      <p class="muted">${terug ? "Log in en je punten en badges staan er weer." : "Je speelt mee zodra je een prijs meldt of incheckt. Met een account bewaar je je punten."}</p>
      ${accountBlok(null)}
      <div class="btns"><button class="btn" data-uitleg>Hoe werkt het?</button><button class="btn" data-regels>Spelregels</button></div>
      ${bugBlok()}
      ${stadKeuzeBlok()}
      ${stadBlok()}
      ${taalBlok()}`;
  }
  if (!state.sessie) {
    // Alleen als anoniem meespelen niet kan: anonieme accounts staan in Supabase uit, of aanmaken lukte niet
    const vorig = onthouden.lees();
    const beginnen = `<p class="muted">Kies een spelersnaam en vul je e-mailadres in. Je krijgt een code per mail, geen wachtwoord nodig.</p>
      <form class="form" id="aanmeldForm">
        <label>E-mailadres</label><input name="email" type="email" autocomplete="email" required>
        <label>Spelersnaam</label><input name="naam" minlength="2" maxlength="24" placeholder="Zichtbaar op de ranglijst" value="${esc(vorig.naam ?? "")}" required>
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
    const terug = state.terugNaar != null ? state.kroegen.find((k) => k.id === state.terugNaar) : null;
    return `<h2>Account maken</h2>${terug ? `<p class="small">Daarna ga je terug naar <b>${esc(terug.naam)}</b>.</p>` : ""}${beginnen}
      <p class="small muted">We belonen bijdragen, nooit drinken.</p>
      <div class="btns"><button class="btn" data-uitleg>Hoe werkt het?</button><button class="btn" data-regels>Spelregels</button></div>
      <h3>Al een account?</h3>
      ${inloggen}`;
  }
  const p = state.profiel;
  const koppelen = anoniem() ? accountBlok(p) : "";
  return `<h2>${esc(p?.naam ?? "")}</h2>
    <div class="card saldo">
      <div class="kop">Puntensaldo</div>
      <div class="big-price">${(p?.altijd ?? 0).toLocaleString(LOCALE)}</div>
      <div class="kv">
        <div>Deze week<b class="${p?.week ? "plus" : ""}">${p?.week ? `↗ +${p.week}` : "0"}</b></div>
        <div>Deze maand<b class="${p?.maand ? "plus" : ""}">${p?.maand ? `+${p.maand}` : "0"}</b></div>
        <div>Betrouwbaar<b>${(p?.altijd ?? 0) === 0 ? "nieuw" : `${Math.round(p?.betrouwbaarheid ?? 50)}%`}</b></div>
      </div>
      <div class="small muted" style="margin-top:10px">${p?.ontdekt ?? 0} ${(p?.ontdekt ?? 0) === 1 ? "kroeg" : "kroegen"} ontdekt. Punten krijg je voor melden en controleren, nooit voor drinken.</div>
    </div>
    ${p && !p.naam_vast && !anoniem() ? `<form class="form" id="naamForm"><label>Kies je spelersnaam</label><input name="naam" minlength="2" maxlength="24" placeholder="Zichtbaar op de ranglijst" required>
      <div class="small muted">Je speelt nu als ${esc(p.naam)}. Je kiest je naam een keer; daarna staat hij vast.</div>
      <div class="btns"><button class="btn primary" type="submit">Naam opslaan</button></div></form>` : ""}
    <div id="badges">${badgesHtml()}</div>
    ${mijnKroegenHtml()}
    ${koppelen}
    <div class="btns"><button class="btn" data-uitleg>Hoe werkt het?</button><button class="btn" data-regels>Spelregels</button></div>
    ${bugBlok()}
    ${stadKeuzeBlok()}
    ${stadBlok()}
    ${taalBlok()}
    ${p?.is_beheerder ? `<h3>Beheer</h3><div class="card"><div class="small muted">Haalt kroegen uit OpenStreetMap en wijken van het CBS voor ${esc(stadNaam)}.</div>
      <div class="btns"><button class="btn primary" data-import>Kroegen en wijken importeren</button></div>
      <div id="beheerMeldingen" class="small muted" style="margin-top:12px">Meldingen laden…</div></div>
      <h3>Stadsaanvragen</h3><div class="card"><div id="beheerSteden" class="small muted">Aanvragen laden…</div></div>
      <h3>Bugs</h3><div class="card"><div id="beheerBugs" class="small muted">Bugs laden…</div></div>
      <h3>Teksten</h3><div class="card"><div class="small muted">Pas elke tekst in de app aan. Zet de bewerkstand aan en tik op een tekst; de wijziging geldt meteen voor iedereen.</div>
      <div class="btns"><button class="btn primary" data-teksten-bewerken>Teksten aanpassen</button></div>
      ${teksten.lijst().length ? `<ul class="list eigen-teksten" data-geen-teksten>${teksten.lijst().map(([sleutel, tekst]) => `<li class="row"><span class="row-main"><span class="row-sub">${esc(sleutel)}</span><span class="row-title">${esc(tekst)}</span></span>
        <button type="button" class="mini" data-tekst-wis="${esc(sleutel)}">Standaard</button></li>`).join("")}</ul>` : `<div class="small muted" style="margin-top:8px">Nog geen eigen teksten.</div>`}</div>` : ""}
    <details class="uitklap" data-onthoud="gegevens"${uitgeklapt("gegevens")}><summary><span class="uitklap-kop">Jouw gegevens</span></summary>
    <p class="small muted">${anoniem() ? "Je speelt zonder e-mailadres. We bewaren alleen je spelersnaam." : "We bewaren je e-mailadres en je spelersnaam. Andere spelers zien alleen je spelersnaam."}
      Je locatie gaat alleen mee als je dat zelf aangeeft, en dan bewaren we alleen de afstand tot de kroeg. Foto's van prijslijsten zijn openbaar, zodat anderen de prijs kunnen nakijken.</p></details>
    <div class="btns">${anoniem() ? "" : `<button class="btn" data-logout>Uitloggen</button>`}<button class="btn stil" data-verwijder>Account verwijderen</button></div>`;
}

// Stad kiezen: alleen als er meer dan een stad meedoet
function stadKeuzeBlok() {
  const steden = state.steden ?? [];
  if (steden.length < 2) return "";
  return `<h3>Stad</h3>
    <div class="form"><select id="stadKeuze" aria-label="Stad" data-geen-teksten>${steden.map((s) =>
      `<option value="${esc(s.gemeente)}"${s.gemeente === stadNaam ? " selected" : ""}>${esc(s.gemeente)} (${s.kroegen})</option>`).join("")}</select></div>`;
}

function kiesStad(naam) {
  if (naam === stadNaam) return;
  stadNaam = naam;
  try { localStorage.setItem("bierkoers-stad", naam); } catch { /* privévenster */ }
  kaartNaarStad = true;
  state.selected = null;
  state.tocht = null;
  state.kroegen = [];
  state.koersRuw = [];
  state.stad = state.steden?.find((s) => s.gemeente === naam) ?? null;
  vernieuw();
  draw();
}

// Taal kiezen. De namen van de talen zelf worden niet vertaald.
function taalBlok() {
  return `<h3 data-geen-teksten>Taal / Language</h3>
    <div class="seg" role="group" aria-label="Taal / Language" data-geen-teksten>
      <button type="button" data-taal="nl" aria-pressed="${TAAL === "nl"}">Nederlands</button>
      <button type="button" data-taal="en" aria-pressed="${TAAL === "en"}">English</button></div>`;
}

// Bug melden: een korte omschrijving; de app stuurt het scherm en de browser mee (functie meld_bug)
function bugBlok() {
  if (!kanBijdragen()) return "";
  return `<details class="klopt-niet bug">
    <summary>Bug melden</summary>
    <form class="form" id="bugForm">
      <label for="bugTekst">Wat ging er mis?</label>
      <textarea id="bugTekst" name="tekst" rows="4" minlength="5" maxlength="2000" placeholder="Wat deed je, en wat gebeurde er?" required></textarea>
      <div class="small muted">We sturen mee welk scherm je open had en welke browser je gebruikt. Geen locatie.</div>
      <div class="btns"><button class="btn primary" type="submit">Versturen</button></div>
    </form>
  </details>`;
}

async function verstuurBug(form) {
  const tekst = String(new FormData(form).get("tekst") ?? "").trim();
  if (tekst.length < 5) return toast("Beschrijf de bug in een paar woorden");
  const knop = form.querySelector("[type=submit]");
  knop.disabled = true;
  if (!(await zorgVoorSpeler())) { knop.disabled = false; return; }
  const scherm = [state.tab, state.modus, state.selected != null ? `kroeg ${state.selected}` : "", `${innerWidth}x${innerHeight}`].filter(Boolean).join(", ");
  const { error } = await sb.rpc("meld_bug", { p_tekst: tekst, p_scherm: scherm, p_apparaat: navigator.userAgent });
  knop.disabled = false;
  if (error) return toast(await leesFout(error));
  form.reset();
  form.closest("details").open = false;
  toast("Bedankt! We kijken ernaar");
}

// Bugs voor de beheerder: de nieuwste dertig
async function laadBeheerBugs() {
  const { data, error } = await sb.from("bugmeldingen").select("id,tekst,scherm,apparaat,op").order("op", { ascending: false }).limit(30);
  const el = $("#beheerBugs");
  if (!el) return;
  if (error) { el.textContent = "Bugs laden lukte niet."; return; }
  if (!data.length) { el.textContent = "Geen bugs gemeld."; return; }
  el.innerHTML = `<ul class="list" data-geen-teksten>${data.map((b) => `<li class="row"><span class="row-main">
    <span class="row-title" style="white-space:normal">${esc(b.tekst)}</span>
    <span class="row-sub" style="white-space:normal">${wanneer(b.op)}${b.scherm ? ` · ${esc(b.scherm)}` : ""}${b.apparaat ? ` · ${esc(b.apparaat)}` : ""}</span></span></li>`).join("")}</ul>`;
}

// Nieuwe stad aanvragen: elke speler kan een stad voorstellen; een beheerder keurt goed (functie vraag_stad_aan)
function stadBlok() {
  if (!kanBijdragen()) return "";
  return `<details class="klopt-niet bug">
    <summary>Nieuwe stad aanvragen</summary>
    <form class="form" id="stadForm">
      <label for="stadNaam">Welke stad wil je vrijspelen?</label>
      <input id="stadNaam" name="stad" minlength="2" maxlength="60" placeholder="Bijvoorbeeld Arnhem" required>
      <div class="small muted">Als genoeg spelers een stad willen, laden we de kroegen in.</div>
      <div class="btns"><button class="btn primary" type="submit">Aanvragen</button></div>
    </form>
  </details>`;
}

async function verstuurStad(form) {
  const stad = String(new FormData(form).get("stad") ?? "").trim();
  if (stad.length < 2) return toast("Vul de naam van een stad in");
  const knop = form.querySelector("[type=submit]");
  knop.disabled = true;
  if (!(await zorgVoorSpeler())) { knop.disabled = false; return; }
  const { error } = await sb.rpc("vraag_stad_aan", { p_stad: stad });
  knop.disabled = false;
  if (error) return toast(await leesFout(error));
  form.reset();
  form.closest("details").open = false;
  toast("Bedankt! We kijken of we deze stad kunnen openen");
}

// Open stadsaanvragen voor de beheerder, per stad geteld
async function laadBeheerSteden() {
  const { data, error } = await sb.from("stadsaanvragen").select("stad,stad_sleutel").eq("status", "open").order("op");
  const el = $("#beheerSteden");
  if (!el) return;
  if (error) { el.textContent = "Aanvragen laden lukte niet."; return; }
  const perStad = new Map();
  for (const r of data) {
    const s = perStad.get(r.stad_sleutel) ?? { naam: r.stad, n: 0 };
    s.n++;
    perStad.set(r.stad_sleutel, s);
  }
  if (!perStad.size) { el.textContent = "Geen open aanvragen."; return; }
  el.innerHTML = `<ul class="list" data-geen-teksten>${[...perStad.values()].sort((a, b) => b.n - a.n).map((s) => `<li class="row"><span class="row-main">
    <span class="row-title">${esc(s.naam)}</span>
    <span class="row-sub">${s.n} ${s.n === 1 ? "speler" : "spelers"}</span></span>
    <button type="button" class="mini" data-stad-ok="${esc(s.naam)}">Goedkeuren</button>
    <button type="button" class="mini" data-stad-nee="${esc(s.naam)}">Afwijzen</button></li>`).join("")}</ul>`;
}

// Goedkeuren: eerst de kroegen en wijken laden, daarna de aanvraag afhandelen
async function keurStad(knop, stad) {
  knop.disabled = true; knop.textContent = "Bezig…";
  const data = await importeerStad(stad);
  if (data) {
    const { error } = await sb.rpc("zet_stadsaanvraag", { p_stad: stad, p_status: "goedgekeurd" });
    if (error) toast(await leesFout(error));
    else toast(`${data.gemeente}: ${data.kroegen} kroegen en ${data.wijken} wijken geïmporteerd`);
    laadStad();
  }
  laadBeheerSteden();
}

// Kroegen en wijken van een gemeente laden (Edge Function osm-import). De functie zoekt de gemeentecode zelf op.
async function importeerStad(gemeente) {
  const { data, error } = await sb.functions.invoke("osm-import", { body: { gemeente } });
  if (!error) return data;
  // De functie geeft de echte reden in het antwoord ({ fout }); supabase-js zegt alleen "non-2xx status code".
  const reden = await error.context?.json?.().then((b) => b?.fout).catch(() => null);
  toast("Import mislukt: " + (reden ?? "de importfunctie gaf geen antwoord"));
  return null;
}

async function wijsStadAf(knop, stad) {
  knop.disabled = true;
  const { error } = await sb.rpc("zet_stadsaanvraag", { p_stad: stad, p_status: "afgewezen" });
  if (error) toast(await leesFout(error));
  laadBeheerSteden();
}

// Spelregels in het kort; de uitwerking staat in supabase/README.md
function regelsView() {
  return `<button class="back" data-sluit-pagina>‹ Terug</button>
    <h2>Spelregels</h2>
    <p>Per kroeg houden we de <b>goedkoopste pils van de tap</b> bij, in een vaasje (25 cl). Schenkt een kroeg geen vaasje, dan meld je het kleinste glas en rekenen we om.</p>
    <h3>Punten</h3>
    <div class="card regels">
      <div><span>Eerste prijs van een kroeg</span><b>+50</b></div>
      <div><span>Nieuwe prijs melden</span><b>+30</b></div>
      <div><span>Melding van een ander bevestigen</span><b>+5</b></div>
      <div><span>Klopt nog</span><b>+5</b></div>
      <div><span>Prijs van 90 dagen of ouder controleren</span><b>+15</b></div>
      <div><span>Foto van de prijslijst</span><b>+5</b></div>
      <div><span>Binnen ${INCHECK_M} m van de kroeg</span><b>×1,5</b></div>
      <div><span>Je melding wordt weerlegd</span><b>−20</b></div>
    </div>
    <p class="small muted">Punten krijg je meteen, ook voor bevestigen.</p>
    <p class="small muted">Een prijs komt pas vast op de kaart als andere spelers hem bevestigen, meestal twee. Zo voorkomen we koersmanipulatie.</p>
    <p class="small muted">Zeggen twee spelers "klopt niet", dan is de melding weerlegd en gaan de punten eraf.</p>`;
}

// Meldingen over kroegen die niet kloppen, voor de beheerder: verkeerde plek, dubbel en gesloten
async function laadBeheerMeldingen() {
  const { data, error } = await sb.from("kroeg_meldingen").select("id,kroeg_id,soort,status,toelichting,op")
    .in("soort", ["verkeerde_plek", "dubbel", "gesloten"]).neq("status", "weerlegd").order("op", { ascending: false }).limit(30);
  const el = $("#beheerMeldingen");
  if (!el) return;
  if (error) { el.textContent = "Meldingen laden lukte niet."; return; }
  if (!data.length) { el.textContent = "Geen meldingen over kroegen."; return; }
  el.innerHTML = `<ul class="list">${data.map((m) => {
    const k = state.kroegen.find((x) => x.id === m.kroeg_id);
    return `<li><button class="row" ${k ? `data-kroeg="${k.id}"` : "disabled"}><span class="row-main">
      <span class="row-title">${esc(k?.naam ?? `Kroeg ${m.kroeg_id} (niet meer op de kaart)`)}</span>
      <span class="row-sub">${esc(KROEGMELDING[m.soort].knop)} · ${m.status === "bevestigd" ? "bevestigd" : "wacht"} · ${wanneer(m.op)}${m.toelichting ? ` · "${esc(m.toelichting)}"` : ""}</span></span></button></li>`;
  }).join("")}</ul>`;
}

// Account verwijderen via de Edge Function account-verwijderen. Prijzen en meldingen blijven, zonder naam.
async function verwijderAccount(knop) {
  if (!(await vraag("Je account verwijderen? Je naam, punten en check-ins zijn dan weg. Prijzen die je hebt gemeld blijven staan, zonder naam. Dit kun je niet terugdraaien.", "Verwijderen"))) return;
  knop.disabled = true;
  const { error } = await sb.functions.invoke("account-verwijderen", { method: "POST" });
  if (error) { knop.disabled = false; return toast(await leesFout(error)); }
  onthouden.schrijf({});
  await sb.auth.signOut({ scope: "local" });
  toast("Je account is verwijderd");
}

// Uitleg bij het eerste bezoek. Onthouden of je hem al zag, mag mislukken (privévenster).
const INTRO = "bierkoers-uitleg-v1";
function toonUitleg() {
  $("#intro").hidden = false;
  $("#introOk").focus();
}
$("#introOk").addEventListener("click", () => {
  $("#intro").hidden = true;
  try { localStorage.setItem(INTRO, "gezien"); } catch { /* geen opslag */ }
});
$("#lightboxSluit").addEventListener("click", () => { $("#lightbox").hidden = true; $("#lightboxImg").removeAttribute("src"); });
addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("#lightbox").hidden) $("#lightboxSluit").click();
  else if (!$("#intro").hidden) $("#introOk").click();
});

// Mijn kroegen: persoonlijk overzicht van waar je hebt ingecheckt, los van het gezamenlijke spel.
// Badges onder Ik: alleen weergave, berekend uit wat de speler deed. Geen punten.
// tel: de teller uit badgeTellers(), doel: hoeveel er nodig is. Elke badge heeft een eigen icoon (24 x 24, lijnen).
const BADGES = [
  { naam: "Eerste check-in", tel: "checkins", doel: 1, uitleg: "1 check-in", icoon: '<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>' },
  { naam: "Kroegloper", tel: "checkins", doel: 10, uitleg: "10 check-ins", icoon: '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-5h4v5"/>' },
  { naam: "Kroegveteraan", tel: "checkins", doel: 50, uitleg: "50 check-ins", icoon: '<path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>' },
  { naam: "Wereldburger", tel: "kroegen", doel: 10, uitleg: "10 verschillende kroegen", icoon: '<path d="M3.5 6.5L9 4l6 2.5L20.5 4v13.5L15 20l-6-2.5-5.5 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>' },
  { naam: "Eerste koers", tel: "prijzen", doel: 1, uitleg: "1 prijs doorgegeven", icoon: '<path d="M3.5 12.5v-8a1 1 0 0 1 1-1h8l8 8-9 9z"/><circle cx="8" cy="8" r="1.5"/>' },
  { naam: "Koersmaker", tel: "prijzen", doel: 25, uitleg: "25 prijzen doorgegeven", icoon: '<path d="M4 20h16"/><path d="M5 16l4-5 4 3 6-8"/>' },
  { naam: "Ontdekker", tel: "ontdekt", doel: 1, uitleg: "Eerste prijs van een kroeg", icoon: '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>' },
  { naam: "Pionier", tel: "ontdekt", doel: 10, uitleg: "Eerste prijs van 10 kroegen", icoon: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>' },
  { naam: "Controleur", tel: "controles", doel: 10, uitleg: "10 keer klopt nog", icoon: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12.5l2.7 2.7L16 9.5"/>' },
  { naam: "Bevestiger", tel: "gegeven", doel: 10, uitleg: "10 meldingen bevestigd", icoon: '<path d="M2.5 13l4 4 7-8"/><path d="M10.5 16l1 1 9-10"/>' },
  { naam: "Betrouwbaar", tel: "ontvangen", doel: 10, uitleg: "10 keer bevestigd door anderen", icoon: '<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z"/><path d="M8.8 12l2.2 2.2 4.2-4.4"/>' },
  { naam: "Fotograaf", tel: "fotos", doel: 5, uitleg: "5 foto's van prijslijsten", icoon: '<path d="M4 8h3.5L9 5.5h6L16.5 8H20v11H4z"/><circle cx="12" cy="13.2" r="3.3"/>' },
  { naam: "Guinnesskenner", tel: "guinness", doel: 1, uitleg: "Een Guinnessprijs doorgegeven", icoon: '<path d="M7 4h10l-1.5 16h-7z"/><path d="M7.4 8.5h9.2"/>' },
];

// Tellers voor de badges. Check-ins en ontdekte kroegen heeft de app al; de rest komt uit laadBadges().
function badgeTellers() {
  let checkins = 0;
  for (const m of state.mijn.values()) checkins += m.keer;
  return { checkins, kroegen: state.mijn.size, ontdekt: state.profiel?.ontdekt ?? 0, ...state.badgeTellers };
}

// Ingeklapt een strook met je behaalde badges; uitgeklapt alle badges met je voortgang
function badgesHtml() {
  const t = badgeTellers();
  const lijst = BADGES.map((b) => ({ ...b, n: t[b.tel] ?? 0 })).map((b) => ({ ...b, behaald: b.n >= b.doel }));
  const behaald = lijst.filter((b) => b.behaald);
  const icoon = (b) => `<span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true">${b.icoon}</svg></span>`;
  return `<details class="uitklap awards-blok" data-onthoud="badges"${uitgeklapt("badges")}>
    <summary><span class="uitklap-kop">Badges · ${behaald.length} van ${lijst.length}</span>
      <span class="awards-strook" aria-hidden="true">${behaald.map((b) => `<span class="award behaald klein" title="${esc(b.naam)}">${icoon(b)}</span>`).join("")}</span></summary>
    <div class="awards">${lijst.map((b) => `<div class="award${b.behaald ? " behaald" : ""}">
      ${icoon(b)}
      <b>${b.naam}</b><span>${b.uitleg}</span>${!b.behaald && b.doel > 1 ? `<span class="vg">${b.n}/${b.doel}</span>` : ""}</div>`).join("")}</div>
  </details>`;
}

// Uitklapblokken met data-onthoud blijven open als het scherm opnieuw wordt getekend (bijvoorbeeld door realtime)
const uitgeklapt = (naam) => (state.uitgeklapt.has(naam) ? " open" : "");

// Tellers die de app nog niet heeft, met een telling per soort bijdrage. Hooguit eens per 15 seconden.
let badgesGeladen = 0;
async function laadBadges() {
  const uid = state.sessie?.user?.id;
  if (!uid || Date.now() - badgesGeladen < 15000) return;
  badgesGeladen = Date.now();
  const tel = (q) => q.then(({ count }) => count ?? 0);
  const melding = () => sb.from("gebeurtenissen").select("id", { count: "exact", head: true }).eq("door_id", uid);
  const [prijzen, controles, fotos, gegeven, ontvangen, guinness] = await Promise.all([
    tel(melding().in("soort", ["eerst", "wijziging"])),
    tel(melding().eq("soort", "check")),
    tel(melding().not("foto_pad", "is", null)),
    tel(sb.from("bevestigingen").select("id", { count: "exact", head: true }).eq("door_id", uid).eq("oordeel", "klopt")),
    // Hoe vaak anderen jouw meldingen bevestigden
    tel(sb.from("bevestigingen").select("id, gebeurtenissen!inner(door_id)", { count: "exact", head: true })
      .eq("gebeurtenissen.door_id", uid).eq("oordeel", "klopt").neq("door_id", uid)),
    tel(sb.from("kroeg_aanbod").select("id", { count: "exact", head: true }).eq("door_id", uid).eq("soort", "guinness")),
  ]);
  state.badgeTellers = { prijzen, controles, fotos, gegeven, ontvangen, guinness };
  const el = $("#badges");
  if (el) { const html = badgesHtml(); if (el.innerHTML !== html) el.innerHTML = html; }
}

function mijnKroegenHtml() {
  const alle = state.kroegen;
  const mijn = alle.filter((k) => state.mijn.has(k.id)).map((k) => ({ ...k, ...state.mijn.get(k.id) }));
  const pct = alle.length ? Math.round((mijn.length / alle.length) * 100) : 0;
  const kop = `<h2 style="margin-top:22px">Mijn kroegen</h2>
    <div class="muted small">Waar jij hebt ingecheckt. Alleen jij ziet dit.</div>`;
  if (!mijn.length) {
    return `${kop}<div class="card"><b>Nog nergens ingecheckt</b>
      <div class="muted small" style="margin-top:4px">Open een kroeg als je er bent en tik op Inchecken (binnen ${INCHECK_M} m), het liefst met de prijs van je pils. Zo speel je de kroeg vrij op jouw eigen kaart.</div>
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
  const eigenIndex = mediaan(mijn.map((k) => prijsPer25(k)).filter(Boolean));
  const pilsindex = state.koers.index?.nu;
  const eerste = mijn.reduce((a, k) => (!a || k.eerste < a ? k.eerste : a), null);
  const laatst = mijn.reduce((a, k) => (!a || k.laatst > a ? k.laatst : a), null);
  const sindsDagen = dagen(laatst);
  const nieuwInBuurt = state.pos
    ? alle.filter((k) => !state.mijn.has(k.id)).map((k) => ({ k, d: afstand(state.pos, [k.lon, k.lat]) })).sort((a, b) => a.d - b.d).slice(0, 3)
    : [];

  return `${kop}
    <div class="statgrid" style="margin-top:12px">
      <div class="card stat"><b class="goud">${mijn.length}</b><span>${mijn.length === 1 ? "kroeg" : "kroegen"}, ${pct}% van ${esc(stadNaam)}</span></div>
      <div class="card stat"><b>${checkins}</b><span>check-ins</span></div>
      ${eigenIndex ? `<div class="card stat"><b>${euro(eigenIndex)}</b><span>jouw index${pilsindex ? `, ${deltaHtml(eigenIndex - pilsindex)} t.o.v. de stad` : ""}</span></div>` : ""}
      <div class="card stat"><b>${eerste ? new Date(eerste).toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "numeric" }) : ""}</b><span>eerste check-in</span></div>
    </div>
    <div class="btns"><button class="btn" data-mijn-kaart>Toon op mijn kaart</button></div>
    ${wijken.length ? `<details class="uitklap" data-onthoud="wijken"${uitgeklapt("wijken")}>
      <summary><span class="uitklap-kop">Wijken bezocht · ${wijkenBezocht} van ${wijken.length}</span></summary>
      <div class="card" style="padding:4px 14px">${wijken.map((w) => `<div class="wijkrij ${w.bezocht ? "" : "leeg"}">
      <div style="display:flex;justify-content:space-between"><span>${esc(w.naam)}</span><span class="small muted">${w.bezocht}/${w.kroegen}</span></div>
      <div class="bar"><span style="width:${(w.bezocht / w.kroegen) * 100}%"></span></div></div>`).join("")}</div>
    </details>` : ""}
    ${vaste && vaste.keer > 1 ? `<button class="row" data-kroeg="${vaste.id}"><span class="row-main"><span class="row-sub">Vaste stek</span><span class="row-title">${esc(vaste.naam)}</span></span><span class="price">${vaste.keer}<small>keer</small></span></button>` : ""}
    ${goedkoopst ? `<button class="row" data-kroeg="${goedkoopst.id}"><span class="row-main"><span class="row-sub">Goedkoopste waar je was</span><span class="row-title">${esc(goedkoopst.naam)}</span></span><span class="price">${spelPrijs(goedkoopst)}<small>per vaasje</small></span></button>` : ""}

    <h3>Volgende kroegentocht</h3>
    <div class="card nacht-kaart">
      <div>Laatste check-in ${sindsDagen === 0 ? "vandaag" : sindsDagen === 1 ? "gisteren" : `${sindsDagen} dagen geleden`}</div>
      <div class="small">Nog ${alle.length - mijn.length} kroegen in ${esc(stadNaam)} waar je niet bent geweest.</div>
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
  const start = state.pos ?? stadCentrum();
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
    <div class="muted small">${t.vanaf === "jij" ? "Vanaf jouw locatie" : `Vanaf het centrum van ${esc(stadNaam)}`}, kroegen binnen ${meters(TOCHT_STRAAL_M)}.
      ${t.vanaf === "jij" ? "" : `<button class="linkbtn" data-tocht-locatie>Gebruik mijn locatie</button>`}</div>
    ${S.length > 1 ? `<label class="veld">Langs</label>
    <div class="seg">${S.map(([id, n]) => `<button type="button" data-tocht-soort="${id}" aria-pressed="${id === t.soort}">${n}</button>`).join("")}</div>` : ""}
    <label class="veld">Aantal kroegen</label>
    <div class="seg">${[3, 4, 5, 6].map((n) => `<button type="button" data-tocht-aantal="${n}" aria-pressed="${n === t.aantal}">${n}</button>`).join("")}</div>
    ${t.stops.length ? `<ul class="list" style="margin-top:12px">${rijen}</ul>
      <div class="small muted" style="margin-top:8px">Ongeveer ${meters(totaal)} lopen (hemelsbreed).</div>
      <div class="btns"><button class="btn primary" data-tocht-kaart>Toon op de kaart</button></div>`
    : `<div class="empty">${t.soort === "nieuw" ? "Je bent overal in de buurt al geweest. Knap!" : "Nog geen prijzen in de buurt."}</div>`}
    <p class="small muted">Check bij elke kroeg in en speel hem vrij op jouw kaart. Geniet, maar drink met mate: inchecken kan ook met een fris.</p>`;
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
      (p) => { state.pos = [p.coords.longitude, p.coords.latitude]; map.getSource("ik")?.setData(ikGeojson()); mist.bij(); resolve(state.pos); },
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
  if (t !== "ik") state.terugNaar = null;
  state.pagina = null;
  state.tab = t; state.selected = null; state.form = null; state.aanbodForm = null; state.tijdenForm = null; state.info = null; state.tocht = null;
  document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === t)));
  kaartBijwerken(); draw(); body.scrollTop = 0;
  // Ik bevat formulieren; in de halve stand valt de onderkant buiten beeld
  if (!wide() && t === "ik") setDetent("full");
  else if (!wide() && sheet.dataset.detent === "peek") setDetent("half");
}

// Punten voor een melding krijg je meteen (trigger punten_bij_melding); ze gaan eraf als de melding wordt weerlegd
const meldPunten = (g) => Math.round((g.soort === "eerst" ? 50 : 30) * (g.ter_plaatse ? 1.5 : 1)) + (g.foto_pad ? 5 : 0);

// Leest het prijsformulier; bij een fout een melding en null
function leesPrijs(form) {
  const fd = new FormData(form);
  const merk = fd.get("merk") === "_anders" ? String(fd.get("merkAnders") ?? "").trim() : String(fd.get("merk"));
  const prijs = Math.round(parseFloat(String(fd.get("prijs")).replace(",", ".")) * 100);
  const cl = gekozenCl();
  if (!merk || merk.length < 2) return toast("Vul een merk in"), null;
  if (!cl) return toast("Vul de inhoud van het glas in, tussen 15 en 100 cl"), null;
  if (!Number.isFinite(prijs) || prijs < 50 || prijs > 2500) return toast("Vul een prijs tussen €0,50 en €25 in"), null;
  return { merk, cl, prijs, foto: fd.get("foto") };
}

async function meldPrijs(k, w, pos) {
  let foto_pad = null;
  if (w.foto && w.foto.size) {
    const file = await verkleinFoto(w.foto);
    if (file.size > 5 * 1024 * 1024) throw new Error("De foto is groter dan 5 MB. Kies een kleinere.");
    const ext = file.type === "image/jpeg" ? "jpg" : (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    foto_pad = `${state.sessie.user.id}/${k.id}-${Date.now()}.${ext}`;
    const { error } = await sb.storage.from("prijslijsten").upload(foto_pad, file, { contentType: file.type, upsert: false });
    if (error) throw error;
  }
  const { data, error } = await sb.rpc("meld_prijs", {
    p_kroeg_id: k.id, p_merk: w.merk, p_volume_cl: w.cl, p_prijs_cent: w.prijs,
    p_lat: pos?.[1] ?? null, p_lon: pos?.[0] ?? null, p_foto_pad: foto_pad,
  });
  if (error) throw error;
  return data;
}

// Inchecken met de prijs van je pils ("klopt", een andere prijs of zonder prijs), of van afstand een prijs doorgeven.
// Ter plaatse is een melding of "klopt nog" in de database vanzelf ook een check-in; anders checken we hier apart in.
async function verstuurIncheck(keuze, form, knop) {
  const k = state.kroegen.find((x) => x.id === state.selected);
  const hier = state.form.hier, b = bekendePrijs(k);
  const w = keuze === "prijs" ? leesPrijs(form) : null;
  if (keuze === "prijs" && !w) return;
  const tekst = knop.textContent;
  form.querySelectorAll("button").forEach((x) => (x.disabled = true));
  const klaar = (msg) => { form.querySelectorAll("button").forEach((x) => (x.disabled = false)); knop.textContent = tekst; if (msg) toast(msg); };
  let pos = null;
  if (hier) {
    knop.textContent = "Locatie zoeken…";
    pos = await locatie(10000);
    if (!pos) return klaar("Zet je locatie aan om in te checken");
    const d = afstand(pos, [k.lon, k.lat]);
    if (d > INCHECK_M) {
      klaar();
      const tekst = `Je bent ${meters(d)} van deze kroeg. Inchecken kan binnen ${INCHECK_M} m.`;
      if (keuze === "zonder") return toast(tekst);
      // GPS zit er vaak tientallen meters naast. Geef de prijs dan van afstand door, zonder punten voor ter plaatse.
      if (!(await vraag(`${tekst} Wil je de prijs doorgeven zonder in te checken?`, "Prijs doorgeven", { gevaar: false }))) return;
      state.form.hier = false;
      return verstuurIncheck(keuze, form, knop);
    }
  }
  knop.textContent = "Bezig…";
  if (!(await zorgVoorSpeler())) return klaar();
  const was = state.mijn.get(k.id), alIn = isVandaag(was?.laatst);
  const delen = [];
  let pts = null, vrij = false;
  try {
    if (keuze === "prijs") {
      const data = await meldPrijs(k, w, pos);
      vrij = data.soort === "eerst";
      delen.push(vrij ? `Eerste prijs van ${k.naam}!` : "Prijs gemeld");
      pts = meldPunten(data);
    } else if (keuze === "klopt" && b.soort === "menukaart") {
      const data = await meldPrijs(k, { merk: b.merk, cl: b.cl, prijs: b.prijs }, pos);
      delen.push("Je bent de indiener; nu nog een bevestiging van een andere speler");
      pts = meldPunten(data);
      vrij = true;
    } else if (keuze === "klopt" && magControleren()) {
      const { data, error } = b.soort === "melding"
        ? await sb.rpc("beoordeel", { p_gebeurtenis: k.open_melding_id, p_oordeel: "klopt" })
        : await sb.rpc("klopt_nog", { p_kroeg_id: k.id, p_lat: pos?.[1] ?? null, p_lon: pos?.[0] ?? null });
      // Ter plaatse telt de check-in; is controleren nu niet mogelijk (eigen melding, al gecontroleerd deze week), dan niet erg
      if (error && !hier) throw error;
      if (!error) {
        delen.push(b.soort === "melding" ? (data === "bevestigd" ? "Bevestigd, de prijs staat erop" : "Oordeel opgeslagen") : "Bedankt voor het controleren");
        pts = b.soort === "melding" ? 5 : dagen(k.laatst_gecontroleerd) >= 90 ? 15 : 5;
      }
    }
  } catch (e) {
    if (!hier) return klaar(await leesFout(e));
    delen.push(`Je prijs is niet doorgegeven: ${await leesFout(e)}`);
  }
  if (hier && !alIn) {
    await laadMijn();
    if (!isVandaag(state.mijn.get(k.id)?.laatst)) {
      const { error } = await sb.rpc("inchecken", { p_kroeg_id: k.id, p_lat: pos[1], p_lon: pos[0] });
      if (error) { await laadMijn(); return klaar(await leesFout(error)); }
    }
    delen.unshift(was ? `Ingecheckt bij ${k.naam}` : `Ingecheckt! ${k.naam} staat nu op jouw kaart`);
  }
  state.form = null;
  toast(delen.join(". ") || "Bedankt", pts);
  // Na een nieuwe check-in meteen naar Mijn kaart: daar trekt de mist rond de kroeg weg. Herladen gebeurt daarna.
  if (hier && !alIn) {
    const nu = new Date().toISOString();
    state.mijn.set(k.id, { kroeg_id: k.id, keer: (was?.keer ?? 0) + 1, eerste: was?.eerste ?? nu, laatst: nu });
    draw();
    toonOpMijnKaart(k, !was);
  } else if (vrij) vierVrij(k);
  await Promise.all([laadKroegen(), laadStad(), laadMijn()]);
  if (!bezigMetTypen()) draw();
}

function toonOpMijnKaart(k, vier) {
  setModus("mijn");
  if (!wide()) setDetent("peek");
  if (!kaartKlaar) return;
  // De mist blijft dicht tot de kaart bij de kroeg is; dan trekt hij weg en dijt de kring uit
  if (vier) { mist.vier(k.id, 650); map.once("moveend", () => vierVrij(k, false)); }
  map.easeTo({ center: [k.lon, k.lat], zoom: Math.max(map.getZoom(), 15), duration: 600, padding: wide() ? { left: 400 } : { bottom: innerHeight * 0.2 } });
}

async function wisMijn() {
  if (!(await vraag("Al je check-ins wissen? Je eigen kaart begint dan weer leeg. Je punten en meldingen blijven.", "Wissen"))) return;
  const { error } = await sb.from("incheckingen").delete().eq("gebruiker_id", state.sessie.user.id);
  if (error) return toast(await leesFout(error));
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
  if (oordeel === "klopt_niet" && !(await vraag("Klopt deze prijs niet? Wordt de melding weerlegd, dan verliest de melder 20 punten. Weet je de juiste prijs, meld die dan daarna.", "Klopt niet"))) return;
  const { data, error } = await sb.rpc("beoordeel", { p_gebeurtenis: g, p_oordeel: oordeel });
  if (error) return toast(await leesFout(error));
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
  if (t.dataset.doeMee !== undefined) { state.terugNaar = state.selected; return setTab("ik"); }
  if (t.dataset.oordeelMelding) return beoordeelMelding(Number(t.dataset.melding), t.dataset.oordeelMelding);
  if (t.dataset.aanbodform !== undefined) { state.aanbodForm = { soort: GUINNESS, cl: PINT }; return draw(); }
  if (t.dataset.guinnessUit !== undefined) return setGuinness(false);
  if (t.dataset.glasGuinness && state.aanbodForm) {
    state.aanbodForm.cl = Number(t.dataset.glasGuinness) || null;
    t.closest(".seg").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === t)));
    const veld = body.querySelector("[name=cl]");
    veld.hidden = !!state.aanbodForm.cl;
    if (!state.aanbodForm.cl) veld.focus();
    return;
  }
  if (t.dataset.oordeelAanbod) return beoordeelAanbod(Number(t.dataset.aanbod), t.dataset.oordeelAanbod);
  if (t.dataset.filter) { state.filter = t.dataset.filter; state.limiet = 40; return draw(); }
  if (t.dataset.wisWijk !== undefined) { state.wijk = null; state.limiet = 40; return draw(); }
  if (t.dataset.wijk) return kiesWijk(t.dataset.wijk);
  if (t.dataset.meer !== undefined) { state.limiet += 40; return draw(); }
  if (t.dataset.locatieLijst !== undefined) return locatie().then((pos) => { if (!pos) toast("Locatie niet beschikbaar. Sta hem toe in de instellingen van je browser."); draw(); });
  if (t.dataset.periode) { state.periode = t.dataset.periode; return rangView(); }
  if (t.dataset.form) {
    const k = state.kroegen.find((x) => x.id === state.selected);
    const cl = k?.huidig_volume_cl ?? k?.open_volume_cl ?? VAASJE;
    // Inchecken ("hier") vraagt de locatie; van afstand ("afstand") gaat er geen locatie mee
    state.form = { hier: t.dataset.form === "hier", anders: false, merk: k?.huidig_merk ?? k?.open_merk ?? "Heineken", cl, clAnders: !GLAZEN.some((g) => g.cl === cl), prijs: "" };
    // Het formulier helemaal open, zodat de prijs en de knop zonder scrollen in beeld zijn
    if (!wide()) setDetent("full");
    return draw();
  }
  if (t.dataset.anderePrijs !== undefined && state.form) { state.form.anders = true; if (!wide()) setDetent("full"); return draw(); }
  if (t.dataset.incheck && state.form) return verstuurIncheck(t.dataset.incheck, t.closest("form"), t);
  if (t.dataset.cl && state.form) {
    state.form.clAnders = t.dataset.cl === "anders";
    if (!state.form.clAnders) state.form.cl = Number(t.dataset.cl);
    t.closest(".seg").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === t)));
    const veld = body.querySelector("[name=clAnders]");
    veld.hidden = !state.form.clAnders;
    if (state.form.clAnders) veld.focus();
    return prijsVoorbeeld();
  }
  if (t.dataset.wisMijn !== undefined) return wisMijn();
  if (t.dataset.taal) {
    if (t.dataset.taal === TAAL) return;
    try { localStorage.setItem("bierkoers-taal", t.dataset.taal); } catch { /* privévenster: alleen voor nu */ }
    return location.reload();
  }
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
  // Alleen met een account; een anonieme speler heeft geen knop om uit te loggen
  if (t.dataset.logout !== undefined) return sb.auth.signOut();
  if (t.dataset.verwijder !== undefined) return verwijderAccount(t);
  if (t.dataset.nieuwecode !== undefined) return stuurCode(state.inlog.email, state.inlog.soort, t, state.inlog.naam);
  if (t.dataset.aanbieder) return inloggenMet(t.dataset.aanbieder, t);
  if (t.dataset.anderadres !== undefined) { state.inlog = null; state.nieuwAdres = null; return draw(); }
  if (t.dataset.import !== undefined) return importeer(t);
  if (t.dataset.stadOk !== undefined) return keurStad(t, t.dataset.stadOk);
  if (t.dataset.stadNee !== undefined) return wijsStadAf(t, t.dataset.stadNee);
  if (t.dataset.foto) return openFoto(t.dataset.foto);
  if (t.dataset.tekstenBewerken !== undefined) { teksten.zetBewerken(true); return toast("Tik op een tekst om hem aan te passen"); }
  if (t.dataset.tekstWis !== undefined) return teksten.wis(t.dataset.tekstWis).then(() => draw());
  if (t.dataset.uitleg !== undefined) return toonUitleg();
  if (t.dataset.regels !== undefined) { state.pagina = "regels"; draw(); body.scrollTop = 0; return; }
  if (t.dataset.sluitPagina !== undefined) { state.pagina = null; return draw(); }
});

// Wie iets gaat invullen, krijgt het hele blad te zien
body.addEventListener("focusin", (e) => {
  if (wide() || !e.target.matches("input, select, textarea")) return;
  if (!e.target.matches("[data-zoek]")) setDetent("full");
  // Wacht tot het blad open is en het toetsenbord staat, en zet het veld dan midden in beeld
  setTimeout(() => e.target.scrollIntoView({ block: "center", behavior: "smooth" }), 400);
});

// "toggle" bubbelt niet, maar is in de capture-fase wel te volgen
body.addEventListener("toggle", (e) => {
  const naam = e.target.dataset?.onthoud;
  if (naam) e.target.open ? state.uitgeklapt.add(naam) : state.uitgeklapt.delete(naam);
}, true);

body.addEventListener("change", (e) => {
  if (e.target.id === "stadKeuze") return kiesStad(e.target.value);
  if (e.target.name === "foto" && e.target.closest("#prijsForm")) {
    const img = $("#fotoVoorbeeld"), file = e.target.files?.[0];
    if (img.src) URL.revokeObjectURL(img.src);
    img.hidden = !file;
    if (file) img.src = URL.createObjectURL(file);
    $("#fotoNaam").textContent = file ? "Andere foto" : "Foto maken of kiezen";
    return;
  }
});

body.addEventListener("input", (e) => {
  if (e.target.matches("[data-zoek]")) {
    state.zoek = e.target.value;
    state.limiet = 40;
    const pos = e.target.selectionStart;
    draw();
    const inp = body.querySelector("[data-zoek]");
    inp.focus(); inp.setSelectionRange(pos, pos);
  }
  if ((e.target.name === "prijs" || e.target.name === "clAnders") && e.target.closest("#prijsForm")) prijsVoorbeeld();
  if (e.target.name === "merk" && e.target.closest("#prijsForm")) {
    const anders = body.querySelector("[name=merkAnders]");
    anders.style.display = e.target.value === "_anders" ? "" : "none";
  }
});

body.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === "prijsForm") return verstuurIncheck("prijs", f, $("#verstuur"));
  if (f.id === "aanbodForm") return verstuurAanbod(f);
  if (f.id === "tijdenForm") return verstuurTijden(f);
  if (f.id === "kroegmeldingForm") return verstuurKroegmelding(f);
  if (f.id === "bugForm") return verstuurBug(f);
  if (f.id === "stadForm") return verstuurStad(f);
  if (f.id === "loginForm" || f.id === "aanmeldForm") {
    const fd = new FormData(f);
    const email = String(fd.get("email")).trim().toLowerCase();
    const naam = fd.has("naam") ? String(fd.get("naam")).trim() : undefined;
    onthouden.schrijf({ ...onthouden.lees(), email, ...(naam ? { naam } : {}) });
    // Een formulier voor inloggen en account maken: bestaat het account niet, dan biedt stuurCode er een aan (nieuwAdres)
    const soort = f.id === "aanmeldForm" ? "aanmelden" : "inloggen";
    return stuurCode(email, soort, f.querySelector("button[type=submit]"), naam);
  }
  // Nieuw account vanuit inloggen: hetzelfde als Account maken met dit e-mailadres. Het anonieme account
  // (zorgVoorSpeler) krijgt het e-mailadres; na de code kiest de speler zijn eigen naam (naamForm).
  if (f.id === "nieuwForm") {
    const email = state.nieuwAdres;
    if (!(await zorgVoorSpeler())) return;
    state.nieuwAdres = null;
    if (await stuurCode(email, "koppelen", f.querySelector("button[type=submit]"))) { await laadProfiel(); draw(); }
    return;
  }
  if (f.id === "codeForm") {
    const knop = f.querySelector("button[type=submit]");
    knop.disabled = true;
    const code = String(new FormData(f).get("code")).replace(/\D/g, "");
    const koppelen = state.inlog.soort === "koppelen";
    if (!koppelen) onthoudAnoniem();
    const { error } = await sb.auth.verifyOtp({ email: state.inlog.email, token: code, type: koppelen ? "email_change" : "email" });
    knop.disabled = false;
    if (error) return toast(vertaalAuthFout(error));
    state.inlog = null;
    // onAuthStateChange zet de sessie en tekent het scherm opnieuw
    if (koppelen) { await laadProfiel(); draw(); }
    toast(!koppelen ? "Je bent ingelogd"
      : state.profiel?.naam_vast === false ? "Je e-mailadres is gekoppeld. Kies nu je eigen spelersnaam" : "Je e-mailadres is gekoppeld. Je punten zijn bewaard");
    return;
  }
  if (f.id === "naamForm") {
    const naam = String(new FormData(f).get("naam")).trim();
    if (!(await vraag(`Wil je "${naam}" als spelersnaam? Je kunt hem daarna niet meer wijzigen.`, "Naam vastzetten", { gevaar: false }))) return;
    const { error } = await sb.from("profielen").update({ naam }).eq("id", state.sessie.user.id);
    if (error) return toast(error.code === "23505" ? "Die naam is al bezet" : error.code === "P0001" ? "Je spelersnaam staat al vast"
      : error.code === "42501" ? "Koppel eerst je e-mailadres om een eigen naam te kiezen" : "Opslaan lukte niet");
    toast("Naam opgeslagen");
    await laadProfiel(); draw();
  }
});

// Meespelen zonder account: de eerste bijdrage (prijs, check-in, Guinness, openingstijden, kroegmelding) of
// Account maken maakt ongemerkt een anoniem account van Supabase, met een vaste gebruikers-ID en een willekeurige
// naam uit de database (dorstige-zebra). Zo ontstaat alleen een account als er echt iets bewaard moet worden.
// De sessie blijft op dit apparaat bewaard (zoals een cookie). Maakt de speler later een account, dan krijgt
// hetzelfde account een e-mailadres: punten, check-ins en ranglijst blijven staan.
let anoniemBezig = null;
let sessieBekend = false; // pas na het starten: anders vervangt een vroege tik een bestaande sessie
let stilAangemeld = false; // het nieuwe anonieme account niet opnieuw tekenen midden in een bijdrage
async function zorgVoorSpeler() {
  if (state.sessie) return true;
  if (!sessieBekend) return false;
  if (!kanAnoniem()) { setTab("ik"); return false; }
  stilAangemeld = true;
  anoniemBezig ??= sb.auth.signInAnonymously().finally(() => { anoniemBezig = null; });
  const { data, error } = await anoniemBezig;
  if (error) {
    stilAangemeld = false;
    state.anoniemMislukt = true;
    toast(vertaalAuthFout(error));
    draw();
    return false;
  }
  state.sessie = data.session;
  return true;
}

// Stuurt een code per mail. "inloggen": bestaand account met e-mailadres. "koppelen": een anonieme speler
// koppelt zijn e-mailadres; het account met alle punten blijft hetzelfde. "aanmelden": nieuw account met
// e-mailadres, alleen als anonieme accounts in Supabase uit staan. Normaal beginnen nieuwe spelers anoniem
// (zorgVoorSpeler), dus inloggen maakt geen nieuw account aan. Hoort bij een e-mailadres nog geen account, dan
// bieden we er een aan (nieuwForm) in plaats van een weigering.
// De code typ je in de app: dat werkt ook als de mail op een ander apparaat of in een andere browser opengaat,
// en een virusscanner van het mailprogramma kan hem niet "opgebruiken" zoals bij een link.
// Geeft true als de code is verstuurd.
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
  if (error) {
    if (soort === "inloggen" && (kanAnoniem() || anoniem()) && /signups not allowed for otp/i.test(error.message ?? "")) {
      state.nieuwAdres = email;
      draw();
      return false;
    }
    toast(vertaalAuthFout(error));
    return false;
  }
  const nieuw = state.inlog == null;
  state.inlog = { ...state.inlog, email, soort, naam };
  if (nieuw) draw();
  else toast("Nieuwe code verstuurd. Gebruik de nieuwste mail.");
  return true;
}

async function importeer(knop) {
  knop.disabled = true; knop.textContent = "Bezig met importeren…";
  const data = await importeerStad(stadNaam);
  knop.disabled = false; knop.textContent = "Kroegen en wijken importeren";
  if (!data) return;
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
$("#guinness").addEventListener("click", () => setGuinness(!guinnessAan()));
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
      if (k) toast(p.new.soort === "check" ? `${k.naam} is net gecontroleerd` : p.new.soort === "eerst" ? `Eerste prijs bij ${k.naam}` : `Nieuwe prijs bij ${k.naam}`);
      // Iemand geeft de eerste prijs van een kroeg door: een gouden kring
      if (k && p.new.soort === "eerst") vierVrij(k);
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
  const vorigeId = state.sessie?.user?.id;
  state.sessie = sessie;
  // Een ander account (of uitgelogd): het codeformulier is klaar. Bij koppelen en bij inloggen vanuit een
  // anonieme speler blijft de sessie tot de code is ingevuld; dan blijft het formulier staan.
  if (!sessie || (sessie.user.id !== vorigeId && state.inlog?.soort !== "koppelen")) state.inlog = null;
  // Elke nieuwe vernieuwingssleutel ook in de bewaarcookie; uitloggen wist hem
  if (sessie) bewaar.zet(sessie);
  else if (gebeurtenis === "SIGNED_OUT") bewaar.zet(null);
  // Tokenvernieuwing: niets opnieuw laden
  if (gebeurtenis === "TOKEN_REFRESHED") return;
  // Niet binnen deze callback op Supabase wachten: supabase-js houdt dan nog een slot vast en de app kan vastlopen.
  setTimeout(async () => {
    await Promise.all([laadProfiel(), laadMijn()]);
    if (stilAangemeld) { stilAangemeld = false; return; }
    if (sessie && !sessie.user.is_anonymous) samenvoegen(sessie.user.id);
    // Kwam de speler via "Doe mee" bij een kroeg? Dan terug naar die kroeg.
    if (sessie && gebeurtenis === "SIGNED_IN" && state.terugNaar != null) {
      const id = state.terugNaar;
      state.terugNaar = null;
      setTab("kaart");
      return openKroeg(id);
    }
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
  // Geen sessie in de browser: misschien wel in de bewaarcookie
  state.sessie = data.session ?? (await bewaar.herstel());
  await Promise.all([laadKroegen(), laadStad(), laadProfiel(), laadAanbieders(), laadAanbod(), laadMijn(), laadKoers(), teksten.laad()]);
  sessieBekend = true; // nu weten we of er al een sessie is en of anonieme accounts in Supabase aanstaan
  koersen(); lichtkrant(); hud(); kaartBijwerken();
  draw();
  setDetent("half");
  try { if (!localStorage.getItem(INTRO) && !urlFout) toonUitleg(); } catch { /* geen opslag: geen uitleg forceren */ }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
