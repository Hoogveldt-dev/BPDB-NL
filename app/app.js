// BPDB Kroegkaart: echte app op Supabase.
// Kaart (MapLibre + OpenFreeMap), inloggen, prijzen melden en bevestigen, foto's, realtime.

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
const ICON_GLAS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h10v15a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M16 8h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M9 9v8M12.5 9v8"/></svg>`;

function toast(msg, pts) {
  const t = $("#toast");
  t.innerHTML = esc(msg) + (pts ? `<span class="pts">${pts > 0 ? "+" : ""}${pts}</span>` : "");
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), 3200);
}

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
};

// Prijs voor het spel: per vaasje; bij een ander glas omgerekend, met een ≈ ervoor
function spelPrijs(k) {
  if (!k.per25_cent) return "";
  return (k.huidig_volume_cl === VAASJE ? "" : "≈ ") + euro(k.per25_cent);
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
  return { fresh: v("--fresh"), stale: v("--stale"), old: v("--old"), locked: v("--locked"), wacht: v("--wacht"), accent: v("--accent"), surface: v("--surface") };
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
        label: state.soort ? (soortIn(k.id)?.prijs_cent ? euro(soortIn(k.id).prijs_cent) : "") : spelPrijs(k),
      },
    })),
  };
}

function kaartLagen() {
  const c = kleur();
  if (map.getSource("kroegen")) return;
  map.addSource("kroegen", { type: "geojson", data: geojson() });
  map.addLayer({
    id: "kroeg-halo", type: "circle", source: "kroegen",
    filter: ["==", ["get", "id"], -1],
    paint: { "circle-radius": 16, "circle-color": c.accent, "circle-opacity": 0.35 },
  });
  map.addLayer({
    id: "kroeg-cirkel", type: "circle", source: "kroegen",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3.5, 15, 7, 17, 9],
      "circle-color": ["match", ["get", "versheid"], "fresh", c.fresh, "stale", c.stale, "old", c.old, "wacht", c.wacht, c.locked],
      "circle-opacity": ["case", ["==", ["get", "versheid"], "locked"], 0.45, 1],
      "circle-stroke-width": 2,
      "circle-stroke-color": c.surface,
    },
  });
  map.addLayer({
    id: "kroeg-prijs", type: "symbol", source: "kroegen", minzoom: 14.5,
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
  if (map.getLayer("kroeg-halo")) map.setFilter("kroeg-halo", ["==", ["get", "id"], state.selected ?? -1]);
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
  kaartBijwerken();
}

async function laadStad() {
  const { data } = await sb.from("stad_voortgang").select("*").eq("gemeente", STAD.naam).maybeSingle();
  state.stad = data;
  hud();
}

async function laadProfiel() {
  const uid = state.sessie?.user?.id;
  if (!uid) { state.profiel = null; return; }
  const { data } = await sb.from("ranglijst").select("*").eq("id", uid).maybeSingle();
  const { data: p } = await sb.from("profielen").select("is_beheerder").eq("id", uid).maybeSingle();
  state.profiel = data ? { ...data, is_beheerder: !!p?.is_beheerder } : null;
}

function hud() {
  const s = state.stad;
  const pct = s && s.kroegen ? Math.round((s.vrijgespeeld / s.kroegen) * 100) : 0;
  const C = 2 * Math.PI * 15;
  const ring = $("#hudRing");
  ring.style.strokeDasharray = C;
  ring.style.strokeDashoffset = C * (1 - pct / 100);
  $("#hudPct").textContent = pct + "%";
  $("#hudSub").textContent = `${STAD.naam} vrijgespeeld`;
}

let vernieuwTimer;
function vernieuw() {
  clearTimeout(vernieuwTimer);
  vernieuwTimer = setTimeout(async () => {
    await Promise.all([laadKroegen(), laadStad(), laadProfiel(), laadAanbod()]);
    if (!bezigMetTypen()) draw();
  }, 400);
}

// ---------------------------------------------------------------------------
// Weergaven
// ---------------------------------------------------------------------------

const body = $("#body");

function draw() {
  let html = "";
  if (state.selected != null) html = state.form ? formView() : state.aanbodForm ? aanbodFormView() : detailView();
  else if (state.tab === "kaart") html = lijstView();
  else if (state.tab === "samen") html = '<div class="empty">Laden…</div>';
  else if (state.tab === "rang") html = '<div class="empty">Laden…</div>';
  else if (state.tab === "ik") html = ikView();
  body.innerHTML = html;
  if (state.selected != null && !state.form && !state.aanbodForm) laadTijdlijn(state.selected);
  else if (state.selected == null && state.tab === "samen") samenView();
  else if (state.selected == null && state.tab === "rang") rangView();
  $("#tabIk").textContent = state.profiel ? state.profiel.naam.slice(0, 10) : "Ik";
}

function kroegVersheid(k) {
  if (k.open_melding_id && !k.huidig_prijs_cent) return "wacht";
  return k.versheid;
}

function rowHtml(k) {
  const v = kroegVersheid(k);
  const d = state.pos ? Math.round(afstand(state.pos, [k.lon, k.lat])) : null;
  const sub = [k.wijk, d != null ? (d < 1000 ? `${d} m` : `${(d / 1000).toFixed(1).replace(".", ",")} km`) : null, VERSHEID[v]].filter(Boolean).join(" · ");
  return `<li><button class="row" data-kroeg="${k.id}">
    <span class="dot ${v}"></span>
    <span class="row-main"><span class="row-title">${esc(k.naam)}</span><span class="row-sub">${esc(sub)}</span></span>
    ${prijsKolom(k)}
  </button></li>`;
}

function prijsKolom(k) {
  if (state.soort) {
    const a = soortIn(k.id);
    return a?.prijs_cent ? `<span class="price">${euro(a.prijs_cent)}<small>${a.volume_cl} cl</small></span>` : "";
  }
  return k.per25_cent ? `<span class="price">${spelPrijs(k)}<small>per vaasje</small></span>` : "";
}

function lijstView() {
  const F = [
    { id: "alles", naam: "Alles", f: () => true },
    { id: "slot", naam: "Op slot", f: (k) => k.versheid === "locked" },
    { id: "oud", naam: "Oud (90+ d)", f: (k) => k.versheid === "old" },
    { id: "wacht", naam: "Te bevestigen", f: (k) => k.open_melding_id },
    { id: "goedkoop", naam: "Goedkoopst", f: (k) => k.per25_cent },
  ];
  const f = F.find((x) => x.id === state.filter) ?? F[0];
  const q = state.zoek.trim().toLowerCase();
  // Met een soort gekozen: "Goedkoopst" sorteert op de prijs van die soort; kroegen zonder prijs ervan achteraan
  const prijsVoor = (k) => state.soort ? (soortIn(k.id)?.prijs_cent ?? Infinity) : k.per25_cent;
  let rows = zichtbareKroegen()
    .filter((k) => state.soort && state.filter === "goedkoop" ? true : f.f(k))
    .filter((k) => !q || k.naam.toLowerCase().includes(q) || (k.wijk ?? "").toLowerCase().includes(q));
  if (state.filter === "goedkoop") rows.sort((a, b) => prijsVoor(a) - prijsVoor(b));
  else if (state.pos) rows.sort((a, b) => afstand(state.pos, [a.lon, a.lat]) - afstand(state.pos, [b.lon, b.lat]));
  const leeg = state.kroegen.length === 0
    ? `<div class="empty">Nog geen kroegen geladen.<br><span class="small">Een beheerder importeert ze via het tabblad Ik.</span></div>`
    : state.soort ? `<div class="empty">Nog geen kroeg met ${esc(soortNaam(state.soort))} gemeld.<br><span class="small">Weet je er een? Voeg het toe bij de kroeg onder "Ook op de tap".</span></div>`
    : `<div class="empty">Niets gevonden.</div>`;
  // Alleen soorten die ergens getapt worden
  const soorten = state.biersoorten.filter((b) => state.aanbod.some((a) => a.soort === b.code) || b.code === state.soort);
  return `<input class="search" type="search" placeholder="Zoek een kroeg of wijk" value="${esc(state.zoek)}" data-zoek>
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
  if (k.open_melding_id) {
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
    <h2>${esc(k.naam)}</h2>
    <div class="muted small">${esc([k.adres, k.wijk].filter(Boolean).join(" · "))}</div>
    <div class="card">
      <span class="badge ${v}">${VERSHEID[v]}</span>
      ${k.huidig_prijs_cent ? `<div class="big-price" style="margin-top:10px">${euro(k.huidig_prijs_cent)}</div>
        <div class="muted">${esc(k.huidig_merk)} · ${k.huidig_volume_cl === VAASJE ? "vaasje (25 cl)" : `${k.huidig_volume_cl} cl, omgerekend ${euro(k.per25_cent)} per vaasje`}</div>
        <div class="muted small">Laatst gecontroleerd ${wanneer(k.laatst_gecontroleerd)}</div>`
      : `<div class="muted" style="margin-top:8px">Nog geen bevestigde prijs.</div>`}
      ${k.ontdekker ? `<div class="small" style="margin-top:8px">Ontdekt door <b>${esc(k.ontdekker)}</b> ${wanneer(k.ontdekt_op)}</div>` : ""}
      ${actie}
      ${ingelogd ? "" : `<div class="small muted" style="margin-top:8px">Doe mee via het tabblad Ik. Een e-mailadres is niet nodig.</div>`}
    </div>
    ${aanbodBlok(k)}
    <h3>Prijs per vaasje, afgelopen jaar</h3>
    <div id="spark"></div>
    <h3>Geschiedenis</h3>
    <div id="stamgast"></div>
    <div id="tijdlijn"><div class="muted small">Laden…</div></div>`;
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
      ${eigen ? `<div class="small muted" style="margin-top:8px">Wacht op bevestiging door een andere speler.</div>`
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
  const keer = (n) => (n === 1 ? "1 keer" : `${n} keer`);
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

function spark(events) {
  const jaar = Date.now() - 365 * 86400000;
  const pts = events.filter((g) => g.status === "bevestigd" && g.soort !== "check" && new Date(g.op) > jaar)
    .map((g) => ({ t: new Date(g.op).getTime(), v: (g.prijs_cent * 25) / g.volume_cl })).reverse();
  if (!pts.length) return `<div class="muted small">Nog geen prijzen dit jaar.</div>`;
  pts.push({ t: Date.now(), v: pts[pts.length - 1].v });
  const med = state.stad?.mediaan_per25_cent;
  const vals = pts.map((p) => p.v).concat(med ? [med] : []);
  const lo = Math.min(...vals) * 0.92, hi = Math.max(...vals) * 1.08;
  const W = 320, H = 80, X = (t) => 4 + ((t - jaar) / (Date.now() - jaar)) * (W - 50), Y = (v) => 6 + (H - 18) * (1 - (v - lo) / (hi - lo || 1));
  let d = `M${X(pts[0].t)},${Y(pts[0].v)}`;
  for (let i = 1; i < pts.length; i++) d += ` H${X(pts[i].t)} V${Y(pts[i].v)}`;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Prijsverloop">
    ${med ? `<line x1="4" x2="${W - 50}" y1="${Y(med)}" y2="${Y(med)}" stroke="var(--muted)" stroke-dasharray="3 3"/><text x="6" y="${Y(med) - 4}" font-size="10" fill="var(--muted)">mediaan ${euro(med)}</text>` : ""}
    <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
    <text x="${W - 46}" y="${Y(pts[pts.length - 1].v) + 4}" font-size="11" font-weight="700" fill="var(--fg)">${euro(Math.round(pts[pts.length - 1].v))}</text>
  </svg>`;
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

async function samenView() {
  const [{ data: wijken }, { data: recent }] = await Promise.all([
    sb.from("wijk_voortgang").select("*").eq("gemeente", STAD.naam).order("naam"),
    sb.from("kroeg_tijdlijn").select("id,kroeg_id,kroeg,soort,status,door,op,prijs_cent").order("op", { ascending: false }).limit(15),
  ]);
  if (state.tab !== "samen" || state.selected != null) return;
  const s = state.stad ?? { kroegen: 0, vrijgespeeld: 0, vers: 0, oud: 0, bijdragen_week: 0, spelers_week: 0 };
  const pct = s.kroegen ? Math.round((s.vrijgespeeld / s.kroegen) * 100) : 0;
  const MS = [25, 50, 75, 100], next = MS.find((m) => m > pct), nodig = next ? Math.ceil((next / 100) * s.kroegen) - s.vrijgespeeld : 0;
  const C = 2 * Math.PI * 42;
  const versPct = s.vrijgespeeld ? Math.round((s.vers / s.vrijgespeeld) * 100) : 0;
  body.innerHTML = `
    <div class="card ring-big">
      <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" class="ring-bg"/><circle cx="50" cy="50" r="42" class="ring-fg" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - pct / 100)}"/></svg>
      <div><div class="pct">${pct}%</div><div>${STAD.naam} samen vrijgespeeld</div>
      <div class="small muted">${s.vrijgespeeld} van ${s.kroegen} kroegen${next ? ` · nog ${nodig} tot ${next}%` : " · alles vrijgespeeld!"}</div></div>
    </div>
    <div class="milestones">${MS.map((m) => `<span class="${pct >= m ? "done" : ""}">${m}%</span>`).join("")}</div>
    <h3>Deze week, met z'n allen</h3>
    <div class="card">
      <div><b>${s.bijdragen_week}</b> van ${WEEKDOEL} bijdragen <span class="muted small">· ${s.spelers_week} spelers</span></div>
      <div class="bar"><span style="width:${Math.min(100, (s.bijdragen_week / WEEKDOEL) * 100)}%"></span></div>
      <div style="margin-top:12px"><b>${s.oud}</b> oude prijzen (90+ dagen) om te controleren <span class="muted small">· +15 per controle</span></div>
      <div style="margin-top:12px"><b>${versPct}%</b> van de prijzen is vers</div>
      <div class="bar fresh"><span style="width:${versPct}%"></span></div>
    </div>
    <h3>Per wijk</h3>
    ${(wijken ?? []).length ? (wijken ?? []).map((w) => `<div class="card" style="padding:10px 14px">
      <div style="display:flex;justify-content:space-between"><b>${esc(w.naam)}</b><span class="small muted">${w.vrijgespeeld}/${w.kroegen}</span></div>
      <div class="bar"><span style="width:${(w.vrijgespeeld / w.kroegen) * 100}%"></span></div></div>`).join("") : `<div class="muted small">Nog geen wijken geladen.</div>`}
    <h3>Recent in de stad</h3>
    ${(recent ?? []).length ? `<ul class="list">${recent.map((g) => `<li><button class="row" data-kroeg="${g.kroeg_id}">
      <span class="row-main"><span class="row-title">${esc(g.door ?? "Iemand")} ${g.soort === "eerst" ? "speelde" : g.soort === "wijziging" ? "wijzigde" : "controleerde"} ${esc(g.kroeg)}${g.soort === "eerst" ? " vrij" : ""}</span>
      <span class="row-sub">${wanneer(g.op)}${g.status === "wacht" ? " · wacht op bevestiging" : g.status === "weerlegd" ? " · weerlegd" : ""}</span></span></button></li>`).join("")}</ul>` : `<div class="muted small">Nog geen activiteit.</div>`}`;
}

async function rangView() {
  const kolom = state.periode;
  const { data } = await sb.from("ranglijst").select("*").gt(kolom, 0).order(kolom, { ascending: false }).limit(50);
  if (state.tab !== "rang" || state.selected != null) return;
  const uid = state.sessie?.user?.id;
  const P = [["week", "Week"], ["maand", "Maand"], ["altijd", "Altijd"]];
  body.innerHTML = `<div class="chips">${P.map(([id, n]) => `<button class="chip" data-periode="${id}" aria-pressed="${id === kolom}">${n}</button>`).join("")}</div>
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
    return `<h2>Doe mee</h2>${beginnen}
      <p class="small muted">We belonen bijdragen, nooit drinken.</p>
      <h3>Al een account?</h3>
      ${aanbiederKnoppen()}
      <div class="of">of met je e-mailadres</div>
      <form class="form" id="loginForm">
        <label>E-mailadres</label><input name="email" type="email" autocomplete="email" value="${esc(vorig.email ?? "")}" required>
        <div class="btns"><button class="btn" type="submit">Stuur inlogcode</button></div>
      </form>`;
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
    <div class="card">
      <div style="display:flex;gap:16px">
        <div><div class="big-price">${p?.altijd ?? 0}</div><div class="muted small">punten</div></div>
        <div><div class="big-price">${p?.ontdekt ?? 0}</div><div class="muted small">ontdekt</div></div>
        <div><div class="big-price">${Math.round(p?.betrouwbaarheid ?? 50)}%</div><div class="muted small">betrouwbaar</div></div>
      </div>
      <div class="small muted" style="margin-top:8px">Deze week ${p?.week ?? 0} punten, deze maand ${p?.maand ?? 0}.</div>
    </div>
    ${koppelen}
    <form class="form" id="naamForm"><label>Spelersnaam</label><input name="naam" minlength="2" maxlength="30" value="${esc(p?.naam ?? "")}">
      <div class="btns"><button class="btn" type="submit">Naam opslaan</button></div></form>
    ${p?.is_beheerder ? `<h3>Beheer</h3><div class="card"><div class="small muted">Haalt kroegen uit OpenStreetMap en wijken van het CBS voor ${STAD.naam}.</div>
      <div class="btns"><button class="btn primary" data-import>Kroegen en wijken importeren</button></div></div>` : ""}
    <div class="btns"><button class="btn bad" data-logout>Uitloggen</button></div>`;
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
  state.form = null; state.aanbodForm = null;
  const k = state.kroegen.find((x) => x.id === state.selected);
  if (k) map.easeTo({ center: [k.lon, k.lat], zoom: Math.max(map.getZoom(), 15.5), duration: 600, padding: wide() ? { left: 400 } : { bottom: innerHeight * 0.45 } });
  kaartBijwerken();
  draw();
  if (!wide()) setDetent("half");
  body.scrollTop = 0;
}

function sluitKroeg() {
  state.selected = null; state.form = null; state.aanbodForm = null;
  kaartBijwerken(); draw();
}

function setTab(t) {
  state.tab = t; state.selected = null; state.form = null; state.aanbodForm = null;
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
    await Promise.all([laadKroegen(), laadStad()]);
    draw();
  } catch (e) {
    toast(e.message || "Versturen mislukt");
    knop.disabled = false; knop.textContent = "Versturen";
  }
}

async function kloptNog(id) {
  const k = state.kroegen.find((x) => x.id === id);
  const pos = await locatie(4000);
  const { error } = await sb.rpc("klopt_nog", { p_kroeg_id: id, p_lat: pos?.[1] ?? null, p_lon: pos?.[0] ?? null });
  if (error) return toast(error.message);
  toast("Bedankt voor het controleren", dagen(k.laatst_gecontroleerd) >= 90 ? 15 : 5);
  vernieuw();
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
  if (t.dataset.cancel !== undefined) { state.form = null; state.aanbodForm = null; return draw(); }
  if (t.dataset.aanbodform !== undefined) { state.aanbodForm = { soort: state.soort || "guinness" }; return draw(); }
  if (t.dataset.oordeelAanbod) return beoordeelAanbod(Number(t.dataset.aanbod), t.dataset.oordeelAanbod);
  if (t.dataset.filter) { state.filter = t.dataset.filter; return draw(); }
  if (t.dataset.periode) { state.periode = t.dataset.periode; return rangView(); }
  if (t.dataset.form) {
    const k = state.kroegen.find((x) => x.id === state.selected);
    state.form = { merk: k?.huidig_merk ?? "Heineken", cl: k?.huidig_volume_cl ?? 25, prijs: "", locatie: true };
    return draw();
  }
  if (t.dataset.cl) {
    state.form.cl = Number(t.dataset.cl);
    document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(b === t)));
    return;
  }
  if (t.dataset.klopt) return kloptNog(Number(t.dataset.klopt));
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
    const { error } = await sb.from("profielen").update({ naam }).eq("id", state.sessie.user.id);
    if (error) return toast(error.code === "23505" ? "Die naam is al bezet" : error.message);
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
  if (error) return toast("Import mislukt: " + (error.message ?? ""));
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
    await laadProfiel();
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
  await Promise.all([laadKroegen(), laadStad(), laadProfiel(), laadAanbieders(), laadAanbod()]);
  draw();
  setDetent("half");
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
