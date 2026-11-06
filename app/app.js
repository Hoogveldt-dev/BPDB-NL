// BPDB Kroegkaart: echte app op Supabase.
// Kaart (MapLibre + OpenFreeMap), inloggen, prijzen melden en bevestigen, foto's, realtime,
// inchecken met een eigen kaart (Mijn kroegen) en een kroegentochtplanner.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY, STAD, KAARTSTIJL } from "./config.js";

const maplibregl = window.maplibregl;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

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
const GLAZEN = [{ naam: "Fluitje", cl: 20 }, { naam: "Vaasje", cl: 25 }, { naam: "Glas", cl: 33 }, { naam: "Pul", cl: 50 }];
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
  mijn: new Map(), // kroeg_id -> { keer, eerste, laatst } uit de view mijn_kroegen (privé)
  modus: "samen", // kaart: "samen" (gezamenlijke mist) of "mijn" (waar jij hebt ingecheckt)
  tocht: null, // { soort: "nieuw" | "goedkoop", aantal, stops: [kroeg], start: [lon, lat], vanaf: "jij" | "centrum" }
};

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
  return { fresh: v("--fresh"), stale: v("--stale"), old: v("--old"), locked: v("--locked"), wacht: v("--wacht"), accent: v("--accent"), accentInk: v("--accent-ink"), surface: v("--surface"), blue: v("--blue") };
}

function geojson() {
  return {
    type: "FeatureCollection",
    features: state.kroegen.map((k) => ({
      type: "Feature",
      id: k.id,
      geometry: { type: "Point", coordinates: [k.lon, k.lat] },
      properties: {
        id: k.id,
        naam: k.naam,
        versheid: k.open_melding_id && k.versheid !== "locked" && !k.huidig_prijs_cent ? "wacht" : k.versheid,
        label: k.per25_cent ? euro(k.per25_cent) : "",
        bezocht: state.mijn.has(k.id),
      },
    })),
  };
}

// Samen: kleur is versheid. Mijn kaart: goud waar je hebt ingecheckt, de rest grijs onder je eigen mist.
function cirkelStijl() {
  const c = kleur();
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
  map.getSource("tocht")?.setData(tochtGeojson());
  if (map.getLayer("kroeg-halo")) map.setFilter("kroeg-halo", ["==", ["get", "id"], state.selected ?? -1]);
  if (map.getLayer("kroeg-cirkel")) for (const [k, v] of Object.entries(cirkelStijl())) map.setPaintProperty("kroeg-cirkel", k, v);
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
}
(function sleep() {
  let startY = 0, startT = 0, dragging = false;
  const grip = (e) => e.target.closest("#grabber, #tabs");
  sheet.addEventListener("pointerdown", (e) => {
    if (wide() || !grip(e) || e.target.closest("button")) return;
    dragging = true; startY = e.clientY;
    startT = parseFloat(getComputedStyle(sheet).getPropertyValue("--sy")) || 0;
    sheet.classList.add("dragging"); sheet.setPointerCapture(e.pointerId);
  });
  sheet.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    sheet.style.setProperty("--sy", Math.max(0, startT + e.clientY - startY) + "px");
  });
  sheet.addEventListener("pointerup", (e) => {
    if (!dragging) return;
    dragging = false; sheet.classList.remove("dragging");
    const dy = e.clientY - startY, d = sheet.dataset.detent;
    const order = ["full", "half", "peek"], i = order.indexOf(d);
    if (dy < -50) setDetent(order[Math.max(0, i - 1)]);
    else if (dy > 50) setDetent(order[Math.min(2, i + 1)]);
    else setDetent(d);
  });
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

async function laadMijn() {
  if (!state.sessie) { state.mijn = new Map(); return; }
  const { data, error } = await sb.from("mijn_kroegen").select("*");
  if (error) { console.error(error); return; }
  state.mijn = new Map(data.map((r) => [r.kroeg_id, r]));
  kaartBijwerken();
  hud();
}

function hud() {
  if (state.modus === "mijn") {
    const totaal = state.kroegen.length, n = state.kroegen.filter((k) => state.mijn.has(k.id)).length;
    zetRing(totaal ? Math.round((n / totaal) * 100) : 0, `${n} van ${totaal} kroegen bezocht`);
    return;
  }
  const s = state.stad;
  const pct = s && s.kroegen ? Math.round((s.vrijgespeeld / s.kroegen) * 100) : 0;
  zetRing(pct, `${STAD.naam} vrijgespeeld`);
}

function zetRing(pct, sub) {
  const C = 2 * Math.PI * 15;
  const ring = $("#hudRing");
  ring.style.strokeDasharray = C;
  ring.style.strokeDashoffset = C * (1 - pct / 100);
  $("#hudPct").textContent = pct + "%";
  $("#hudSub").textContent = sub;
}

function setModus(m) {
  state.modus = m;
  document.querySelectorAll("#modus button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.modus === m)));
  kaartBijwerken();
  hud();
  if (m === "mijn" && !state.sessie) toast("Log in via Ik om je eigen kaart te zien");
}

let vernieuwTimer;
function vernieuw() {
  clearTimeout(vernieuwTimer);
  vernieuwTimer = setTimeout(async () => {
    await Promise.all([laadKroegen(), laadStad(), laadProfiel(), laadMijn()]);
    draw();
  }, 400);
}

// ---------------------------------------------------------------------------
// Weergaven
// ---------------------------------------------------------------------------

const body = $("#body");

function draw() {
  let html = "";
  if (state.selected != null) html = state.form ? formView() : detailView();
  else if (state.tocht) html = tochtView();
  else if (state.tab === "kaart") html = lijstView();
  else if (state.tab === "samen") html = '<div class="empty">Laden…</div>';
  else if (state.tab === "rang") html = '<div class="empty">Laden…</div>';
  else if (state.tab === "ik") html = ikView();
  body.innerHTML = html;
  if (state.selected != null && !state.form) laadTijdlijn(state.selected);
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
  const sub = [k.wijk, d != null ? meters(d) : null, VERSHEID[v], state.mijn.has(k.id) ? "bezocht" : null].filter(Boolean).join(" · ");
  return `<li><button class="row" data-kroeg="${k.id}">
    <span class="dot ${v}"></span>
    <span class="row-main"><span class="row-title">${esc(k.naam)}</span><span class="row-sub">${esc(sub)}</span></span>
    ${k.per25_cent ? `<span class="price">${euro(k.per25_cent)}<small>per 25 cl</small></span>` : ""}
  </button></li>`;
}

function lijstView() {
  const F = [
    { id: "alles", naam: "Alles", f: () => true },
    { id: "slot", naam: "Op slot", f: (k) => k.versheid === "locked" },
    { id: "oud", naam: "Oud (90+ d)", f: (k) => k.versheid === "old" },
    { id: "wacht", naam: "Te bevestigen", f: (k) => k.open_melding_id },
    { id: "goedkoop", naam: "Goedkoopst", f: (k) => k.per25_cent },
    ...(state.sessie ? [{ id: "nieuw", naam: "Nog niet bezocht", f: (k) => !state.mijn.has(k.id) }] : []),
  ];
  const f = F.find((x) => x.id === state.filter) ?? F[0];
  const q = state.zoek.trim().toLowerCase();
  let rows = state.kroegen.filter(f.f).filter((k) => !q || k.naam.toLowerCase().includes(q) || (k.wijk ?? "").toLowerCase().includes(q));
  if (state.filter === "goedkoop") rows.sort((a, b) => a.per25_cent - b.per25_cent);
  else if (state.pos) rows.sort((a, b) => afstand(state.pos, [a.lon, a.lat]) - afstand(state.pos, [b.lon, b.lat]));
  const leeg = state.kroegen.length === 0
    ? `<div class="empty">Nog geen kroegen geladen.<br><span class="small">Een beheerder importeert ze via het tabblad Ik.</span></div>`
    : `<div class="empty">Niets gevonden.</div>`;
  return `<input class="search" type="search" placeholder="Zoek een kroeg of wijk" value="${esc(state.zoek)}" data-zoek>
    <button class="row tocht-link" data-tocht-open><span class="ic-sm">${ICON_ROUTE}</span><span class="row-main"><span class="row-title">Plan een kroegentocht</span><span class="row-sub">Langs de goedkoopste kroegen of waar je nog niet was</span></span><span class="muted">›</span></button>
    <div class="chips">${F.map((x) => `<button class="chip" data-filter="${x.id}" aria-pressed="${x.id === f.id}">${x.naam}</button>`).join("")}</div>
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
      <button class="btn good" data-klopt="${k.id}" ${ingelogd ? "" : "disabled"}>Klopt nog</button>
      <button class="btn" data-form="nieuw" ${ingelogd ? "" : "disabled"}>Prijs is anders</button></div>`;
  }
  return `<button class="back" data-back>‹ Terug</button>
    <h2>${esc(k.naam)}</h2>
    <div class="muted small">${esc([k.adres, k.wijk].filter(Boolean).join(" · "))}</div>
    <div class="card">
      <span class="badge ${v}">${VERSHEID[v]}</span>
      ${k.huidig_prijs_cent ? `<div class="big-price" style="margin-top:10px">${euro(k.huidig_prijs_cent)}</div>
        <div class="muted">${esc(k.huidig_merk)} · ${k.huidig_volume_cl} cl · ${euro(k.per25_cent)} per 25 cl</div>
        <div class="muted small">Laatst gecontroleerd ${wanneer(k.laatst_gecontroleerd)}</div>`
      : `<div class="muted" style="margin-top:8px">Nog geen bevestigde prijs.</div>`}
      ${k.ontdekker ? `<div class="small" style="margin-top:8px">Ontdekt door <b>${esc(k.ontdekker)}</b> ${wanneer(k.ontdekt_op)}</div>` : ""}
      ${actie}
      ${ingelogd ? "" : `<div class="small muted" style="margin-top:8px">Log in via het tabblad Ik om mee te spelen.</div>`}
    </div>
    ${incheckHtml(k)}
    <h3>Prijs per 25 cl, afgelopen jaar</h3>
    <div id="spark"></div>
    <h3>Geschiedenis</h3>
    <div id="stamgast"></div>
    <div id="tijdlijn"><div class="muted small">Laden…</div></div>`;
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
    <form class="form" id="prijsForm">
      <label>Merk</label>
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

function ikView() {
  if (!state.sessie) {
    return `<h2>Doe mee</h2>
      <p class="muted">Log in met je e-mailadres. Je krijgt een link om in te loggen, geen wachtwoord nodig.</p>
      <form class="form" id="loginForm">
        <label>E-mailadres</label><input name="email" type="email" autocomplete="email" required>
        <label>Spelersnaam</label><input name="naam" minlength="2" maxlength="24" placeholder="Zichtbaar op de ranglijst" required>
        <label class="check"><input type="checkbox" name="leeftijd" required> Ik ben 18 jaar of ouder</label>
        <div class="btns"><button class="btn primary" type="submit">Stuur inloglink</button></div>
      </form>
      <p class="small muted">We belonen bijdragen, nooit drinken.</p>`;
  }
  const p = state.profiel;
  return `<h2>${esc(p?.naam ?? "")}</h2>
    <div class="card">
      <div style="display:flex;gap:16px">
        <div><div class="big-price">${p?.altijd ?? 0}</div><div class="muted small">punten</div></div>
        <div><div class="big-price">${p?.ontdekt ?? 0}</div><div class="muted small">ontdekt</div></div>
        <div><div class="big-price">${Math.round(p?.betrouwbaarheid ?? 50)}%</div><div class="muted small">betrouwbaar</div></div>
      </div>
      <div class="small muted" style="margin-top:8px">Deze week ${p?.week ?? 0} punten, deze maand ${p?.maand ?? 0}.</div>
    </div>
    ${mijnKroegenHtml()}
    <form class="form" id="naamForm"><label>Spelersnaam</label><input name="naam" minlength="2" maxlength="30" value="${esc(p?.naam ?? "")}">
      <div class="btns"><button class="btn" type="submit">Naam opslaan</button></div></form>
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
  const gem = metPrijs.length ? Math.round(metPrijs.reduce((n, k) => n + k.per25_cent, 0) / metPrijs.length) : null;
  const med = state.stad?.mediaan_per25_cent;
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
      ${gem ? `<div class="card stat"><b>${euro(gem)}</b><span>gemiddeld per 25 cl${med ? `, stad ${euro(med)}` : ""}</span></div>` : ""}
      <div class="card stat"><b>${eerste ? new Date(eerste).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" }) : ""}</b><span>eerste check-in</span></div>
    </div>
    ${vaste && vaste.keer > 1 ? `<button class="row" data-kroeg="${vaste.id}"><span class="row-main"><span class="row-sub">Vaste stek</span><span class="row-title">${esc(vaste.naam)}</span></span><span class="price">${vaste.keer}<small>keer</small></span></button>` : ""}
    ${goedkoopst ? `<button class="row" data-kroeg="${goedkoopst.id}"><span class="row-main"><span class="row-sub">Goedkoopste waar je was</span><span class="row-title">${esc(goedkoopst.naam)}</span></span><span class="price">${euro(goedkoopst.per25_cent)}<small>per 25 cl</small></span></button>` : ""}

    <h3>Volgende kroegentocht</h3>
    <div class="card nacht-kaart">
      <div>Laatste check-in ${sindsDagen === 0 ? "vandaag" : sindsDagen === 1 ? "gisteren" : `${sindsDagen} dagen geleden`}</div>
      <div class="small">Nog ${alle.length - mijn.length} kroegen in ${esc(STAD.naam)} waar je niet bent geweest.</div>
      <div class="btns"><button class="btn primary" data-tocht-open="nieuw">Plan een tocht langs nieuwe kroegen</button></div>
    </div>
    ${nieuwInBuurt.length ? `<div class="muted small" style="margin-top:4px">Dichtbij en nog niet bezocht</div>
      <ul class="list">${nieuwInBuurt.map(({ k, d }) => `<li><button class="row" data-kroeg="${k.id}"><span class="dot ${kroegVersheid(k)}"></span>
        <span class="row-main"><span class="row-title">${esc(k.naam)}</span><span class="row-sub">${meters(d)}${k.wijk ? ` · ${esc(k.wijk)}` : ""}</span></span>
        ${k.per25_cent ? `<span class="price">${euro(k.per25_cent)}<small>per 25 cl</small></span>` : ""}</button></li>`).join("")}</ul>` : ""}
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
      <span class="row-main"><span class="row-title">${esc(k.naam)}</span><span class="row-sub">${meters(d)}${k.wijk ? ` · ${esc(k.wijk)}` : ""}${state.mijn.has(k.id) ? " · bezocht" : state.sessie ? " · nieuw voor jou" : ""}</span></span>
      ${k.per25_cent ? `<span class="price">${euro(k.per25_cent)}<small>per 25 cl</small></span>` : ""}</button></li>`;
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
  state.form = null;
  const k = state.kroegen.find((x) => x.id === state.selected);
  if (k) map.easeTo({ center: [k.lon, k.lat], zoom: Math.max(map.getZoom(), 15.5), duration: 600, padding: wide() ? { left: 400 } : { bottom: innerHeight * 0.45 } });
  kaartBijwerken();
  draw();
  if (!wide()) setDetent("half");
  body.scrollTop = 0;
}

function sluitKroeg() {
  state.selected = null; state.form = null;
  kaartBijwerken(); draw();
}

function setTab(t) {
  state.tab = t; state.selected = null; state.form = null; state.tocht = null;
  document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === t)));
  kaartBijwerken(); draw(); body.scrollTop = 0;
  if (!wide() && sheet.dataset.detent === "peek") setDetent("half");
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
  if (t.dataset.cancel !== undefined) { state.form = null; return draw(); }
  if (t.dataset.filter) { state.filter = t.dataset.filter; return draw(); }
  if (t.dataset.periode) { state.periode = t.dataset.periode; return rangView(); }
  if (t.dataset.form) {
    const k = state.kroegen.find((x) => x.id === state.selected);
    state.form = { merk: k?.huidig_merk ?? "Heineken", cl: k?.huidig_volume_cl ?? 25, prijs: "", locatie: true };
    return draw();
  }
  if (t.dataset.cl && state.form) {
    state.form.cl = Number(t.dataset.cl);
    document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(b === t)));
    return;
  }
  if (t.dataset.klopt) return kloptNog(Number(t.dataset.klopt));
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
  if (t.dataset.logout !== undefined) return sb.auth.signOut();
  if (t.dataset.import !== undefined) return importeer(t);
});

body.addEventListener("input", (e) => {
  if (e.target.matches("[data-zoek]")) {
    state.zoek = e.target.value;
    const pos = e.target.selectionStart;
    draw();
    const inp = body.querySelector("[data-zoek]");
    inp.focus(); inp.setSelectionRange(pos, pos);
  }
  if (e.target.name === "merk") {
    const anders = body.querySelector("[name=merkAnders]");
    anders.style.display = e.target.value === "_anders" ? "" : "none";
  }
});

body.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === "prijsForm") return verstuurPrijs(f);
  if (f.id === "loginForm") {
    const fd = new FormData(f);
    const { error } = await sb.auth.signInWithOtp({
      email: String(fd.get("email")),
      options: { data: { naam: String(fd.get("naam")).trim() }, emailRedirectTo: location.origin + location.pathname },
    });
    if (error) return toast(error.message);
    f.innerHTML = `<div class="card">Check je mail en tik op de inloglink.</div>`;
  }
  if (f.id === "naamForm") {
    const naam = String(new FormData(f).get("naam")).trim();
    const { error } = await sb.from("profielen").update({ naam }).eq("id", state.sessie.user.id);
    if (error) return toast(error.code === "23505" ? "Die naam is al bezet" : error.message);
    toast("Naam opgeslagen");
    await laadProfiel(); draw();
  }
});

async function importeer(knop) {
  knop.disabled = true; knop.textContent = "Bezig met importeren…";
  const { data, error } = await sb.functions.invoke("osm-import", { body: { gemeente: STAD.naam, gemeentecode: STAD.gemeentecode } });
  knop.disabled = false; knop.textContent = "Kroegen en wijken importeren";
  if (error) return toast("Import mislukt: " + (error.message ?? ""));
  toast(`${data.kroegen} kroegen en ${data.wijken} wijken geïmporteerd`);
  vernieuw();
}

$("#tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setTab(b.dataset.tab); });
$("#modus").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setModus(b.dataset.modus); });
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
  .subscribe();

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

// Geen Supabase-aanroepen direct in deze callback: auth-js houdt dan nog een lock vast en
// wachtende verzoeken blokkeren elkaar. Daarom het laden een tik later.
sb.auth.onAuthStateChange((_e, sessie) => {
  state.sessie = sessie;
  setTimeout(async () => {
    await Promise.all([laadProfiel(), laadMijn()]);
    draw();
  }, 0);
});

(async function start() {
  const { data } = await sb.auth.getSession();
  state.sessie = data.session;
  await Promise.all([laadKroegen(), laadStad(), laadProfiel(), laadMijn()]);
  draw();
  setDetent("half");
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
