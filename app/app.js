// BPDB Kroegkaart: echte app op Supabase.
// Kaart (MapLibre + OpenFreeMap), inloggen, prijzen melden en bevestigen, foto's, realtime.
// Per kroeg telt het goedkoopste bier op de kaart. Vergelijken doen we per 25 cl.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY, STAD, KAARTSTIJL } from "./config.js";

const maplibregl = window.maplibregl;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&", "<": "<", ">": ">", '"': """, "'": "&#39;" }[c]));
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
const MERKEN = ["Heineken", "Amstel", "Grolsch", "Brand", "Bavaria", "Hertog Jan", "Jupiler", "Gulpener", "Dommelsch"];
const WEEKDOEL = 12;
const STAMGAST_MIN = 2;
const INTRO_SLEUTEL = "bpdb-intro-v1";
const ICON_GLAS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h10v15a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M16 8h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M9 9v8M12.5 9v8"/></svg>`;
const FOUTEN = [
  "Log eerst in",
  "Kroeg bestaat niet",
  "Er staat al een melding open voor deze kroeg; bevestig of weerleg die eerst",
  "Foto hoort niet bij jou",
  'Deze prijs staat er al; tik op "Klopt nog"',
  "Melding bestaat niet",
  "Deze melding is al afgerond",
  "Je kunt je eigen melding niet beoordelen",
  "Je hebt deze melding al beoordeeld",
  "Deze kroeg heeft nog geen bevestigde prijs",
  'Er staat een melding open; beoordeel die in plaats van "Klopt nog"',
  "Je hebt deze kroeg deze week al gecontroleerd",
  "Niet ingelogd",
  "Alleen voor beheerders",
];

function toast(msg, pts) {
  const t = $("#toast");
  t.innerHTML = esc(msg) + (pts ? `<span class="pts">${pts > 0 ? "+" : ""}${pts}</span>` : "");
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), msg.length > 70 ? 5200 : 3200);
}

async function leesFout(error) {
  let m = error?.message || "Er ging iets mis";
  const ctx = error?.context;
  if (ctx && typeof ctx.clone === "function") {
    try {
      const j = await ctx.clone().json();
      if (j?.fout) return j.fout;
      if (typeof j?.message === "string") m = j.message;
    } catch { /* response was geen JSON */ }
  }
  const bekend = FOUTEN.find((s) => m.includes(s));
  if (bekend) return bekend;
  if (error?.code === "23505") return "Die naam of melding bestaat al";
  if (/jwt|expired|network|fetch|failed to fetch|non-2xx|unexpected|permission/i.test(m)) {
    return "Geen verbinding, of je sessie is verlopen. Probeer het opnieuw.";
  }
  return m;
}

function afstand(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function betrouwTekst(r) {
  if (!r || (r.altijd ?? 0) === 0) return "Nieuw, nog weinig bevestigd";
  return `betrouwbaarheid ${Math.round(r.betrouwbaarheid)}%`;
}

const state = {
  tab: "kaart",
  kroegen: [],
  stad: null,
  selected: null,
  form: null,
  pagina: null,
  filter: "alles",
  sort: "afstand",
  inBeeld: false,
  wijk: null,
  limiet: 40,
  zoek: "",
  periode: "week",
  sessie: null,
  profiel: null,
  pos: null,
};

const donker = matchMedia("(prefers-color-scheme: dark)");
const map = new maplibregl.Map({
  container: "map",
  style: donker.matches ? KAARTSTIJL.donker : KAARTSTIJL.licht,
  center: STAD.centrum,
  zoom: STAD.zoom,
  attributionControl: { compact: true },
});
let kaartKlaar = false;
const hover = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, className: "kroeg-tip", maxWidth: "240px" });

function kleur() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return { fresh: v("--fresh"), stale: v("--stale"), old: v("--old"), locked: v("--locked"), wacht: v("--wacht"), accent: v("--accent"), surface: v("--surface") };
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
    paint: { "circle-radius": 20, "circle-color": c.accent, "circle-opacity": 0.4 },
  });
  map.addLayer({
    id: "kroeg-cirkel", type: "circle", source: "kroegen",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 5.5, 14, 8, 16, 11],
      "circle-color": ["match", ["get", "versheid"], "fresh", c.fresh, "stale", c.stale, "old", c.old, "wacht", c.wacht, c.locked],
      "circle-opacity": ["case", ["==", ["get", "versheid"], "locked"], 0.28, 1],
      "circle-stroke-width": ["case", ["==", ["get", "versheid"], "locked"], 2.5, 2],
      "circle-stroke-color": ["case", ["==", ["get", "versheid"], "locked"], c.locked, c.surface],
    },
  });
  map.addLayer({
    id: "kroeg-prijs", type: "symbol", source: "kroegen", minzoom: 13.8,
    filter: ["!=", ["get", "label"], ""],
    layout: {
      "text-field": ["get", "label"],
      "text-font": ["Noto Sans Bold"],
      "text-size": 12,
      "text-offset": [0, -1.6],
      "text-allow-overlap": false,
    },
    paint: { "text-color": donker.matches ? "#f2f2f7" : "#1c1c1e", "text-halo-color": c.surface, "text-halo-width": 2 },
  });
  map.addLayer({
    id: "kroeg-hit", type: "circle", source: "kroegen",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 16, 15, 20, 17, 24],
      "circle-color": "#000000",
      "circle-opacity": 0.01,
    },
  });
  bindKaartEvents();
  zorgVoorPositieLaag();
  kaartBijwerken();
}

function onKroegClick(e) {
  const lijst = e.features?.length ? e.features : [];
  if (!lijst.length) return;
  let best = lijst[0], bestD = Infinity;
  for (const f of lijst) {
    const [lon, lat] = f.geometry.coordinates;
    const d = (lon - e.lngLat.lng) ** 2 + (lat - e.lngLat.lat) ** 2;
    if (d < bestD) { bestD = d; best = f; }
  }
  openKroeg(best.properties.id);
}
function onKroegEnter() { map.getCanvas().style.cursor = "pointer"; }
function onKroegLeave() { map.getCanvas().style.cursor = ""; hover.remove(); }
function onKroegMove(e) {
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  const f = e.features?.[0];
  if (!f) return;
  const k = kroegById(f.properties.id);
  const extra = k?.per25_cent ? ` · ${euro(k.per25_cent)} / 25 cl` : " · op slot";
  hover.setLngLat(f.geometry.coordinates).setHTML(`<strong>${esc(k?.naam || f.properties.naam)}</strong><span class="muted">${esc(extra)}</span>`).addTo(map);
}
function bindKaartEvents() {
  map.off("click", "kroeg-hit", onKroegClick);
  map.off("mouseenter", "kroeg-hit", onKroegEnter);
  map.off("mouseleave", "kroeg-hit", onKroegLeave);
  map.off("mousemove", "kroeg-hit", onKroegMove);
  map.on("click", "kroeg-hit", onKroegClick);
  map.on("mouseenter", "kroeg-hit", onKroegEnter);
  map.on("mouseleave", "kroeg-hit", onKroegLeave);
  map.on("mousemove", "kroeg-hit", onKroegMove);
}

map.on("load", () => { kaartKlaar = true; kaartLagen(); });
map.on("moveend", () => {
  if (state.inBeeld && state.tab === "kaart" && state.selected == null && state.pagina == null) verversLijst();
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

function zorgVoorPositieLaag() {
  if (!kaartKlaar || !state.pos) return;
  const data = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: state.pos }, properties: {} }] };
  if (!map.getSource("ik")) {
    map.addSource("ik", { type: "geojson", data });
    map.addLayer({
      id: "ik-dot", type: "circle", source: "ik",
      paint: { "circle-radius": 7, "circle-color": "#007aff", "circle-stroke-width": 3, "circle-stroke-color": "#ffffff" },
    });
  } else map.getSource("ik").setData(data);
}

function vierVrij(k) {
  if (!k || matchMedia("(prefers-reduced-motion: reduce)").matches || !kaartKlaar) return;
  const p = map.project([k.lon, k.lat]);
  const el = document.createElement("div");
  el.className = "burst";
  el.style.left = p.x + "px";
  el.style.top = p.y + "px";
  document.body.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
}

const sheet = $("#sheet");
const wide = () => matchMedia("(min-width: 900px)").matches;
function setDetent(d) {
  sheet.dataset.detent = d;
  if (wide()) return;
  const h = sheet.getBoundingClientRect().height;
  const y = d === "full" ? 0 : d === "half" ? h - innerHeight * 0.48 : h - 168;
  sheet.style.setProperty("--sy", Math.max(0, y) + "px");
}
(function sleep() {
  let drag = null;
  let suppressClick = false;
  sheet.addEventListener("pointerdown", (e) => {
    if (wide() || !e.target.closest(".sheet-head")) return;
    drag = {
      y: e.clientY,
      y0: parseFloat(getComputedStyle(sheet).getPropertyValue("--sy")) || 0,
      moved: false,
      cap: false,
    };
    sheet.classList.add("dragging");
  });
  sheet.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    if (Math.abs(dy) > 8) {
      drag.moved = true;
      if (!drag.cap) {
        drag.cap = true;
        try { sheet.setPointerCapture(e.pointerId); } catch { /* al losgelaten */ }
      }
      sheet.style.setProperty("--sy", Math.max(0, drag.y0 + dy) + "px");
    }
  });
  const los = (e) => {
    if (!drag) return;
    const moved = drag.moved;
    const dy = e.clientY - drag.y;
    drag = null;
    sheet.classList.remove("dragging");
    if (!moved) return;
    suppressClick = true;
    const d = sheet.dataset.detent;
    const order = ["full", "half", "peek"];
    const i = order.indexOf(d);
    if (dy < -40) setDetent(order[Math.max(0, i - 1)]);
    else if (dy > 40) setDetent(order[Math.min(2, i + 1)]);
    else setDetent(d);
  };
  sheet.addEventListener("pointerup", los);
  sheet.addEventListener("pointercancel", los);
  sheet.addEventListener("click", (e) => {
    if (!suppressClick) return;
    suppressClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  $(".sheet-head").addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    setDetent(sheet.dataset.detent === "full" ? "half" : "full");
  });
  addEventListener("resize", () => setDetent(sheet.dataset.detent));
})();

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
  $("#hudSub").textContent = "van de kroegen";
}

let vernieuwTimer;
function vernieuw() {
  clearTimeout(vernieuwTimer);
  vernieuwTimer = setTimeout(async () => {
    await Promise.all([laadKroegen(), laadStad(), laadProfiel()]);
    if (state.form) return;
    const zoekActief = document.activeElement?.matches?.("[data-zoek]");
    if (zoekActief && state.tab === "kaart" && state.selected == null && !state.pagina) {
      verversLijst();
      return;
    }
    draw();
  }, 400);
}

const body = $("#body");
const kroegById = (id) => state.kroegen.find((x) => String(x.id) === String(id));

function draw() {
  const kroegOpen = state.selected != null;
  let html = "";
  if (kroegOpen && state.pagina === "login") html = loginView(true);
  else if (kroegOpen) html = state.form ? formView() : detailView();
  else if (state.pagina === "regels") html = regelsView();
  else if (state.tab === "kaart") html = lijstView();
  else if (state.tab === "samen") html = '<div class="empty">Laden…</div>';
  else if (state.tab === "rang") html = '<div class="empty">Laden…</div>';
  else if (state.tab === "ik") html = ikView();
  body.innerHTML = html;
  if (kroegOpen && !state.form && state.pagina !== "login") laadTijdlijn(state.selected);
  else if (!kroegOpen && !state.pagina && state.tab === "samen") samenView();
  else if (!kroegOpen && !state.pagina && state.tab === "rang") rangView();
  else if (!kroegOpen && !state.pagina && state.tab === "ik" && state.profiel?.is_beheerder) laadTerugmeldingen();
  const tabIk = $("#tabIk");
  if (tabIk) tabIk.textContent = state.profiel ? state.profiel.naam.slice(0, 10) : "Ik";
}

function kroegVersheid(k) {
  if (k.open_melding_id && !k.huidig_prijs_cent) return "wacht";
  return k.versheid;
}

function rowHtml(k) {
  const v = kroegVersheid(k);
  const d = state.pos ? Math.round(afstand(state.pos, [k.lon, k.lat])) : null;
  const sub = [k.wijk, d != null ? (d < 1000 ? `${d} m` : `${(d / 1000).toFixed(1).replace(".", ",")} km`) : null, VERSHEID[v]].filter(Boolean).join(" · ");
  const prijs = k.huidig_prijs_cent
    ? `<span class="price">${euro(k.huidig_prijs_cent)}<small>${esc(k.huidig_merk)} · ${k.huidig_volume_cl} cl</small><small>${euro(k.per25_cent)} / 25 cl</small></span>`
    : "";
  return `<li><button class="row" data-kroeg="${k.id}">
    <span class="dot ${v}"></span>
    <span class="row-main"><span class="row-title">${esc(k.naam)}</span><span class="row-sub">${esc(sub)}</span></span>
    ${prijs}
  </button></li>`;
}

function inBeeld(k) {
  if (!state.inBeeld || !kaartKlaar) return true;
  const b = map.getBounds();
  return k.lon >= b.getWest() && k.lon <= b.getEast() && k.lat >= b.getSouth() && k.lat <= b.getNorth();
}

function gefilterdeKroegen() {
  const filters = {
    alles: () => true,
    slot: (k) => k.versheid === "locked",
    oud: (k) => k.versheid === "old",
    wacht: (k) => !!k.open_melding_id,
  };
  const f = filters[state.filter] || filters.alles;
  const q = state.zoek.trim().toLowerCase();
  const rows = state.kroegen.filter(f).filter(inBeeld).filter((k) => {
    if (state.wijk && k.wijk !== state.wijk) return false;
    if (!q) return true;
    return k.naam.toLowerCase().includes(q) || (k.wijk ?? "").toLowerCase().includes(q) || (k.adres ?? "").toLowerCase().includes(q);
  });
  const ver = (k) => (state.pos ? afstand(state.pos, [k.lon, k.lat]) : Number.POSITIVE_INFINITY);
  if (state.sort === "prijs") rows.sort((a, b) => (a.per25_cent ?? 1e9) - (b.per25_cent ?? 1e9) || a.naam.localeCompare(b.naam, "nl"));
  else if (state.sort === "naam") rows.sort((a, b) => a.naam.localeCompare(b.naam, "nl"));
  else rows.sort((a, b) => ver(a) - ver(b) || a.naam.localeCompare(b.naam, "nl"));
  return rows;
}

function lijstView() {
  const F = [["alles", "Alles"], ["slot", "Op slot"], ["oud", "Oud"], ["wacht", "Te bevestigen"]];
  const S = [["afstand", "Afstand"], ["prijs", "Prijs"], ["naam", "Naam"]];
  const rows = gefilterdeKroegen();
  const zichtbaar = rows.slice(0, state.limiet);
  const leeg = state.kroegen.length === 0
    ? "De kaart is nog leeg. Kroegen verschijnen hier zodra ze zijn geïmporteerd."
    : "Niets gevonden. Probeer een andere zoekterm of filter.";
  const locatieHint = state.sort === "afstand" && !state.pos
    ? `<p class="small muted hint">Zonder locatie sorteren we op naam. <button type="button" class="link" data-locate-list>Gebruik mijn locatie</button>, dan staat de dichtstbijzijnde kroeg bovenaan.</p>`
    : "";
  const wijkChip = state.wijk ? `<button class="chip" data-wis-wijk aria-pressed="true">${esc(state.wijk)} · wis</button>` : "";
  return `<input class="search" type="search" placeholder="Zoek een kroeg, wijk of straat" value="${esc(state.zoek)}" data-zoek>
    <div class="chips">${F.map(([id, naam]) => `<button class="chip" data-filter="${id}" aria-pressed="${id === state.filter}">${naam}</button>`).join("")}${wijkChip}</div>
    <div class="chips">${S.map(([id, naam]) => `<button class="chip" data-sort="${id}" aria-pressed="${id === state.sort}">${naam}</button>`).join("")}
      <button class="chip" data-beeld aria-pressed="${state.inBeeld}">In beeld</button></div>
    ${locatieHint}
    <p class="legend-row"><i class="dot fresh"></i> vers <i class="dot stale"></i> wordt oud <i class="dot old"></i> 90+ <i class="dot locked"></i> op slot <i class="dot wacht"></i> wacht</p>
    <p class="small muted" data-lijst-meta>${rows.length ? `${rows.length} kroegen` : ""}</p>
    <div class="empty" data-leeg ${rows.length ? "hidden" : ""}>${leeg}</div>
    <ul class="list" data-lijst>${zichtbaar.map(rowHtml).join("")}</ul>
    <div data-meer-wrap ${rows.length > state.limiet ? "" : "hidden"}><button type="button" class="btn" data-meer>Toon er nog <span data-meer-aantal>${Math.max(0, rows.length - state.limiet)}</span></button></div>`;
}

function verversLijst() {
  if (!body.querySelector("[data-lijst]")) return;
  const rows = gefilterdeKroegen();
  const zichtbaar = rows.slice(0, state.limiet);
  body.querySelector("[data-lijst]").innerHTML = zichtbaar.map(rowHtml).join("");
  const meta = body.querySelector("[data-lijst-meta]");
  if (meta) meta.textContent = rows.length ? `${rows.length} kroegen` : "";
  const leeg = body.querySelector("[data-leeg]");
  if (leeg) leeg.hidden = rows.length > 0;
  const meer = body.querySelector("[data-meer-wrap]");
  if (meer) {
    meer.hidden = rows.length <= state.limiet;
    const n = meer.querySelector("[data-meer-aantal]");
    if (n) n.textContent = String(Math.max(0, rows.length - state.limiet));
  }
}

function detailView() {
  const k = kroegById(state.selected);
  if (!k) return `<button class="back" data-back>‹ Terug</button><div class="empty">Kroeg niet gevonden.</div>`;
  const v = kroegVersheid(k);
  const ingelogd = !!state.sessie;
  let actie = "";
  if (!ingelogd) {
    actie = `<div class="btns"><button class="btn primary" data-login>Log in om een prijs te melden</button></div>
      <p class="small muted">Prijzen melden en bevestigen kan zodra je bent ingelogd. Je krijgt een link in je mail, geen wachtwoord.</p>`;
  } else if (k.open_melding_id) {
    actie = `<div class="card" id="openMelding"><div class="muted small">Melding laden…</div></div>`;
  } else if (k.versheid === "locked") {
    actie = `<div class="btns"><button class="btn primary" data-form="nieuw">Speel vrij met het goedkoopste bier</button></div>`;
  } else {
    actie = `<div class="btns">
      <button class="btn good" data-klopt="${k.id}">Klopt nog</button>
      <button class="btn" data-form="nieuw">Prijs is anders</button></div>
      <p class="small muted">Locatie gaat alleen mee als je die al hebt toegestaan. Binnen 75 m tellen de punten 1,5 keer. Eén controle per kroeg per week.</p>`;
  }
  const rapport = ingelogd ? `<details class="report"><summary>Klopt deze kroeg niet?</summary>
      <p class="small muted">Dicht, verkeerde plek of een dubbele. Een beheerder kijkt ernaar. De prijs zelf weerleg je hierboven.</p>
      <div class="btns">
        <button type="button" class="btn" data-rapport="dicht">Dicht</button>
        <button type="button" class="btn" data-rapport="verkeerde_plek">Verkeerde plek</button>
        <button type="button" class="btn" data-rapport="duplicaat">Dubbel</button>
      </div></details>` : "";
  return `<button class="back" data-back>‹ Terug</button>
    <h2>${esc(k.naam)}</h2>
    <div class="muted small">${esc([k.adres, k.wijk].filter(Boolean).join(" · "))}</div>
    <div class="card">
      <span class="badge ${v}">${VERSHEID[v]}</span>
      ${k.huidig_prijs_cent ? `<div class="big-price" style="margin-top:10px">${euro(k.huidig_prijs_cent)}</div>
        <div>${esc(k.huidig_merk)} · ${k.huidig_volume_cl} cl</div>
        <div class="muted">${euro(k.per25_cent)} per 25 cl · goedkoopste bier op de kaart</div>
        <div class="muted small">Laatst gecontroleerd ${wanneer(k.laatst_gecontroleerd || k.prijs_sinds)}</div>`
      : `<div class="muted" style="margin-top:8px">Nog geen bevestigde prijs. Meld het goedkoopste bier dat hier op de kaart staat.</div>`}
      ${k.ontdekker ? `<div class="small" style="margin-top:8px">Ontdekt door <b>${esc(k.ontdekker)}</b> ${wanneer(k.ontdekt_op)}</div>` : ""}
      ${actie}
    </div>
    <h3>Prijs per 25 cl, afgelopen jaar</h3>
    <div id="spark"></div>
    <h3>Geschiedenis</h3>
    <div id="stamgast"></div>
    <div id="tijdlijn"><div class="muted small">Laden…</div></div>
    ${rapport}`;
}

async function laadTijdlijn(id) {
  const uid = state.sessie?.user?.id;
  let bijdragersQuery = sb.from("kroeg_bijdragers").select("gebruiker_id,naam,bijdragen,plek").eq("kroeg_id", id);
  bijdragersQuery = uid ? bijdragersQuery.or(`plek.eq.1,gebruiker_id.eq.${uid}`) : bijdragersQuery.eq("plek", 1);
  const [{ data, error }, { data: bijdragers, error: bijdragersFout }] = await Promise.all([
    sb.from("kroeg_tijdlijn").select("*").eq("kroeg_id", id).order("op", { ascending: false }).limit(60),
    bijdragersQuery,
  ]);
  if (state.selected !== id && String(state.selected) !== String(id)) return;
  const tijdlijn = $("#tijdlijn");
  if (!tijdlijn) return;
  if (error) { tijdlijn.innerHTML = `<div class="muted small">Laden mislukt.</div>`; return; }
  const stam = $("#stamgast");
  if (stam) stam.innerHTML = data.length && !bijdragersFout ? stamgastHtml(bijdragers ?? [], uid) : "";
  const open = data.find((g) => g.status === "wacht");
  const el = $("#openMelding");
  if (el && open) {
    const eigen = open.door_id === uid;
    const al = state.profiel && [...open.bevestigd_door, ...open.weerlegd_door].includes(state.profiel.naam);
    el.innerHTML = `<div><b>${esc(open.door)}</b> meldt ${euro(open.prijs_cent)} voor ${esc(open.merk)} ${open.volume_cl} cl</div>
      <div class="muted small">${wanneer(open.op)}${open.ter_plaatse ? " · ter plaatse" : ""}${open.uitschieter ? " · wijkt sterk af van de stad, twee bevestigingen nodig" : ""}</div>
      ${open.foto_pad ? `<div class="small"><button type="button" class="link" data-foto="${esc(fotoUrl(open.foto_pad))}">Foto van de prijslijst</button></div>` : ""}
      ${eigen ? `<div class="small muted" style="margin-top:8px">Wacht op bevestiging door een andere speler. Punten volgen daarna.</div>`
        : al ? `<div class="small muted" style="margin-top:8px">Je hebt deze melding al beoordeeld.</div>`
        : `<div class="btns"><button class="btn good" data-oordeel="klopt" data-g="${open.id}">Klopt</button>
             <button class="btn bad" data-oordeel="klopt_niet" data-g="${open.id}">Klopt niet</button></div>`}`;
  }
  tijdlijn.innerHTML = data.length ? `<ul class="timeline">${data.map(tijdlijnItem).join("")}</ul>` : `<div class="muted small">Nog niets gebeurd.</div>`;
  const sparkEl = $("#spark");
  if (sparkEl) sparkEl.innerHTML = spark(data);
}

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
    ${g.foto_pad ? `<div class="t-meta"><button type="button" class="link" data-foto="${esc(fotoUrl(g.foto_pad))}">Foto</button></div>` : ""}</li>`;
}

function spark(events) {
  const jaar = Date.now() - 365 * 86400000;
  const pts = events.filter((g) => g.status === "bevestigd" && g.soort !== "check" && new Date(g.op) > jaar)
    .map((g) => ({ t: new Date(g.op).getTime(), v: (g.prijs_cent * 25) / g.volume_cl })).reverse();
  if (!pts.length) return `<div class="muted small">Nog geen prijzen dit jaar.</div>`;
  pts.push({ t: Date.now(), v: pts[pts.length - 1].v });
  const med = state.stad?.mediaan_per25_cent;
  const vals = pts.map((p) => p.v).concat(med ? [med] : []);
  const lo = Math.min(...vals) * 0.92, hi = Math.max(...vals) * 1.08 || 1;
  const W = 320, H = 80, X = (t) => 4 + ((t - jaar) / (Date.now() - jaar)) * (W - 50), Y = (v) => 6 + (H - 18) * (1 - (v - lo) / (hi - lo || 1));
  let d = `M${X(pts[0].t)},${Y(pts[0].v)}`;
  for (let i = 1; i < pts.length; i++) d += ` H${X(pts[i].t)} V${Y(pts[i].v)}`;
  const labelY = Math.min(H - 4, Math.max(12, Y(med || 0) - 4));
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Prijsverloop per 25 cl">
    ${med ? `<line x1="4" x2="${W - 50}" y1="${Y(med)}" y2="${Y(med)}" stroke="var(--muted)" stroke-dasharray="3 3"/><text x="6" y="${labelY}" font-size="10" fill="var(--muted)">mediaan ${euro(med)}</text>` : ""}
    <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
    <text x="${W - 46}" y="${Math.min(H - 4, Math.max(12, Y(pts[pts.length - 1].v) + 4))}" font-size="11" font-weight="700" fill="var(--fg)">${euro(Math.round(pts[pts.length - 1].v))}</text>
  </svg>`;
}

function formView() {
  const k = kroegById(state.selected);
  const f = state.form;
  const bekendMerk = MERKEN.includes(f.merk);
  return `<button class="back" data-cancel>‹ Annuleer</button>
    <h2>${k.versheid === "locked" ? "Speel vrij" : "Nieuwe prijs"}</h2>
    <div class="muted small">${esc(k.naam)}</div>
    <p class="small">Het goedkoopste bier op de kaart. Soms is dat Amstel, soms Hertog Jan. Geen apart huismerk. We vergelijken daarna per 25 cl.</p>
    <form class="form" id="prijsForm">
      <label>Merk van dat bier</label>
      <select name="merk">${MERKEN.map((m) => `<option ${m === f.merk ? "selected" : ""}>${m}</option>`).join("")}<option value="_anders" ${bekendMerk ? "" : "selected"}>Ander bekend merk…</option></select>
      <input name="merkAnders" placeholder="Merk dat niet in de lijst staat" style="margin-top:6px;${bekendMerk ? "display:none" : ""}" value="${bekendMerk ? "" : esc(f.merk)}">
      <label>Glas</label>
      <div class="seg">${GLAZEN.map((g) => `<button type="button" data-cl="${g.cl}" aria-pressed="${!f.clAnders && g.cl === f.cl}">${g.naam}<br><span class="small muted">${g.cl} cl</span></button>`).join("")}
        <button type="button" data-cl="anders" aria-pressed="${f.clAnders}">Anders</button></div>
      <input name="clAnders" type="number" min="15" max="100" inputmode="numeric" placeholder="Inhoud in cl" ${f.clAnders ? "" : "hidden"} value="${f.clAnders ? esc(f.cl) : ""}">
      <label>Prijs van dat glas, in euro</label>
      <input name="prijs" inputmode="decimal" placeholder="3,50" required value="${esc(f.prijs ?? "")}">
      <p class="small muted" id="prijsPreview">Vul de prijs in. Je ziet meteen wat dat per 25 cl is.</p>
      <label>Foto van de prijslijst (optioneel, +5 na bevestiging)</label>
      <input name="foto" type="file" accept="image/*" capture="environment">
      <img class="foto-preview" id="fotoPreview" alt="" hidden>
      <label class="check"><input type="checkbox" name="locatie"> Ik ben in deze kroeg. Binnen 75 m tellen punten 1,5 keer. De locatie bewaren we alleen bij deze melding.</label>
      <div class="btns"><button class="btn primary" type="submit" id="verstuur">Versturen</button></div>
      <p class="small muted">Punten voor een nieuwe prijs volgen pas als een andere speler je melding bevestigt.</p>
    </form>`;
}

function gekozenCl() {
  if (!state.form) return null;
  if (state.form.clAnders) {
    const n = Number(body.querySelector("[name=clAnders]")?.value);
    return n >= 15 && n <= 100 ? n : null;
  }
  return state.form.cl;
}

function updatePrijsPreview() {
  const el = $("#prijsPreview");
  const form = $("#prijsForm");
  if (!el || !form) return;
  const raw = String(new FormData(form).get("prijs") || "").replace(",", ".");
  const euroIn = parseFloat(raw);
  const cl = gekozenCl();
  if (!Number.isFinite(euroIn) || !cl) {
    el.className = "small muted";
    el.textContent = "Vul prijs en glas in. We vergelijken het goedkoopste bier per 25 cl.";
    return;
  }
  const cent = Math.round(euroIn * 100);
  const per = Math.round((cent * 25) / cl);
  const med = state.stad?.mediaan_per25_cent;
  const uitschieter = med && Math.abs(per - med) > med * 0.4;
  el.className = uitschieter ? "small warn" : "small muted";
  el.textContent = `${euro(cent)} voor ${cl} cl = ${euro(per)} per 25 cl.${med ? ` Stadsgemiddelde ${euro(med)}.` : ""}${uitschieter ? " Dit wijkt sterk af. Twee anderen moeten het bevestigen." : ""}`;
}

async function samenView() {
  const [{ data: wijken }, { data: recent }] = await Promise.all([
    sb.from("wijk_voortgang").select("*").eq("gemeente", STAD.naam).order("naam"),
    sb.from("kroeg_tijdlijn").select("id,kroeg_id,kroeg,soort,status,door,op,prijs_cent,merk").order("op", { ascending: false }).limit(15),
  ]);
  if (state.tab !== "samen" || state.selected != null || state.pagina) return;
  const s = state.stad ?? { kroegen: 0, vrijgespeeld: 0, vers: 0, oud: 0, bijdragen_week: 0, spelers_week: 0 };
  const pct = s.kroegen ? Math.round((s.vrijgespeeld / s.kroegen) * 100) : 0;
  const MS = [25, 50, 75, 100], next = MS.find((m) => m > pct), nodig = next ? Math.ceil((next / 100) * s.kroegen) - s.vrijgespeeld : 0;
  const C = 2 * Math.PI * 42;
  const versPct = s.vrijgespeeld ? Math.round((s.vers / s.vrijgespeeld) * 100) : 0;
  body.innerHTML = `
    <div class="card ring-big">
      <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" class="ring-bg"/><circle cx="50" cy="50" r="42" class="ring-fg" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - pct / 100)}"/></svg>
      <div><div class="pct">${pct}%</div><div>${STAD.naam} samen vrijgespeeld</div>
      <div class="small muted">${s.vrijgespeeld} van ${s.kroegen} kroegen${next ? ` · nog ${nodig} tot ${next}%` : " · alles vrijgespeeld"}</div></div>
    </div>
    <div class="milestones">${MS.map((m) => `<span class="${pct >= m ? "done" : ""}">${m}%</span>`).join("")}</div>
    <h3>Deze week, met z'n allen</h3>
    <div class="card">
      <div><b>${s.bijdragen_week}</b> van ${WEEKDOEL} bijdragen <span class="muted small">· ${s.spelers_week} spelers</span></div>
      <div class="bar"><span style="width:${Math.min(100, (s.bijdragen_week / WEEKDOEL) * 100)}%"></span></div>
      <p class="small muted">${WEEKDOEL} is een zacht doel voor de hele stad, geen prijs. Het houdt de kaart in beweging.</p>
      <div style="margin-top:12px"><b>${s.oud}</b> oude prijzen (90+ dagen) om te controleren <span class="muted small">· +15 per controle</span></div>
      <div style="margin-top:12px"><b>${versPct}%</b> van de prijzen is vers</div>
      <div class="bar fresh"><span style="width:${versPct}%"></span></div>
    </div>
    <h3>Per wijk</h3>
    <p class="small muted">Tik een wijk aan om hem op de kaart te zien.</p>
    ${(wijken ?? []).length ? (wijken ?? []).map((w) => `<button type="button" class="card wijk" data-wijk="${esc(w.naam)}">
      <div style="display:flex;justify-content:space-between"><b>${esc(w.naam)}</b><span class="small muted">${w.vrijgespeeld}/${w.kroegen}</span></div>
      <div class="bar"><span style="width:${w.kroegen ? (w.vrijgespeeld / w.kroegen) * 100 : 0}%"></span></div></button>`).join("") : `<div class="muted small">Nog geen wijken geladen.</div>`}
    <h3>Recent in de stad</h3>
    ${(recent ?? []).length ? `<ul class="list">${recent.map((g) => {
      const werk = g.soort === "eerst" ? "speelde" : g.soort === "wijziging" ? "wijzigde" : "controleerde";
      const extra = g.soort === "eerst" ? " vrij" : "";
      const prijs = g.prijs_cent && g.soort !== "check" ? ` · ${euro(g.prijs_cent)}${g.merk ? ` ${g.merk}` : ""}` : "";
      return `<li><button class="row" data-kroeg="${g.kroeg_id}">
      <span class="row-main"><span class="row-title">${esc(g.door ?? "Iemand")} ${werk} ${esc(g.kroeg)}${extra}${esc(prijs)}</span>
      <span class="row-sub">${wanneer(g.op)}${g.status === "wacht" ? " · wacht op bevestiging" : g.status === "weerlegd" ? " · weerlegd" : ""}</span></span></button></li>`;
    }).join("")}</ul>` : `<div class="muted small">Nog geen activiteit.</div>`}`;
}

async function rangView() {
  const kolom = state.periode;
  const { data } = await sb.from("ranglijst").select("*").gt(kolom, 0).order(kolom, { ascending: false }).limit(50);
  if (state.tab !== "rang" || state.selected != null || state.pagina) return;
  const uid = state.sessie?.user?.id;
  const P = [["week", "Week"], ["maand", "Maand"], ["altijd", "Altijd"]];
  body.innerHTML = `<p class="small muted">Wie het meest bijdraagt. <button type="button" class="link" data-regels>Hoe punten werken</button></p>
    <div class="chips">${P.map(([id, n]) => `<button class="chip" data-periode="${id}" aria-pressed="${id === kolom}">${n}</button>`).join("")}</div>
    ${(data ?? []).length ? `<ul class="list">${data.map((r, i) => `<li class="row ${r.id === uid ? "me" : ""}">
      <span class="rank">${i + 1}</span>
      <span class="row-main"><span class="row-title">${esc(r.naam)}</span><span class="row-sub">${r.ontdekt} ontdekt · ${esc(betrouwTekst(r))}</span></span>
      <span class="price">${r[kolom]}<small>punten</small></span></li>`).join("")}</ul>` : `<div class="empty">Nog niemand heeft punten in deze periode.</div>`}`;
}

function loginView(vanKroeg) {
  return `${vanKroeg ? `<button class="back" data-sluit-pagina>‹ Terug naar de kroeg</button>` : ""}
    <h2>Doe mee</h2>
    <p class="muted">Log in met je e-mail. Je krijgt een link, geen wachtwoord. Open die link in deze browser. Niets gezien? Kijk in spam.</p>
    <form class="form" id="loginForm">
      <label>E-mailadres</label><input name="email" type="email" autocomplete="email" required>
      <label>Spelersnaam <span class="muted">(alleen de eerste keer)</span></label>
      <input name="naam" minlength="2" maxlength="24" autocomplete="nickname" placeholder="Zichtbaar op de ranglijst">
      <label class="check"><input type="checkbox" name="leeftijd" required> Ik ben 18 jaar of ouder</label>
      <div class="btns"><button class="btn primary" type="submit">Stuur inloglink</button></div>
    </form>
    <p class="small muted">We vergelijken het goedkoopste bier per kroeg. Punten krijg je voor bijdragen, nooit voor drinken.</p>`;
}

function regelsView() {
  return `<button class="back" data-sluit-pagina>‹ Terug</button>
    <h2>Spelregels</h2>
    <p>Per kroeg melden we het <b>goedkoopste bier op de kaart</b>. Het merk verschilt per kroeg. Een fluitje en een pul vergelijken we via de prijs per 25 cl.</p>
    <div class="card">
      <div>Kroeg vrijspelen, eerste prijs <b>+50</b></div>
      <div>Prijswijziging <b>+30</b>, pas na bevestiging</div>
      <div>Bevestigen of een terechte weerlegging <b>+5</b></div>
      <div>Klopt nog <b>+5</b>, meteen. Hoogstens één keer per kroeg per 7 dagen</div>
      <div>Prijs van 90 dagen of ouder controleren <b>+15</b></div>
      <div>Foto van de kaart <b>+5</b></div>
      <div>Binnen 75 m van de kroeg <b>×1,5</b></div>
      <div>Melding weerlegd <b>−20</b> voor de melder</div>
    </div>
    <p class="small muted">Een prijs is bevestigd na een tweede speler. Wijkt hij sterk af van de stad, dan zijn twee anderen nodig. Een melder met hoge betrouwbaarheid is soms meteen bevestigd, behalve bij zo'n uitschieter.</p>
    <p class="small muted">Betrouwbaarheid begint op 50%. "Nieuw" betekent nog geen punten, niet dat iemand onbetrouwbaar is.</p>`;
}

function ikView() {
  if (!state.sessie) return loginView(false);
  const p = state.profiel;
  return `<h2>${esc(p?.naam ?? "")}</h2>
    <div class="card">
      <div style="display:flex;gap:16px">
        <div><div class="big-price">${p?.altijd ?? 0}</div><div class="muted small">punten</div></div>
        <div><div class="big-price">${p?.ontdekt ?? 0}</div><div class="muted small">ontdekt</div></div>
        <div><div class="big-price">${Math.round(p?.betrouwbaarheid ?? 50)}%</div><div class="muted small">${(p?.altijd ?? 0) === 0 ? "nieuw" : "betrouwbaar"}</div></div>
      </div>
      <div class="small muted" style="margin-top:8px">${esc(betrouwTekst(p))}. Deze week ${p?.week ?? 0} punten, deze maand ${p?.maand ?? 0}.</div>
    </div>
    <div class="btns"><button class="btn" data-regels>Spelregels</button><button class="btn" data-intro>Uitleg op de kaart</button></div>
    <form class="form" id="naamForm"><label>Spelersnaam</label><input name="naam" minlength="2" maxlength="30" value="${esc(p?.naam ?? "")}">
      <div class="btns"><button class="btn" type="submit">Naam opslaan</button></div></form>
    <h3>Gegevens</h3>
    <p class="small muted">We bewaren je e-mailadres en spelersnaam. Een locatie alleen als je die bij een melding meestuurt, en dan alleen de afstand tot de kroeg. Foto's van prijslijsten zijn openbaar, omdat andere spelers de prijs moeten kunnen nakijken. Alleen voor 18+.</p>
    ${p?.is_beheerder ? `<h3>Beheer</h3><div class="card"><div class="small muted">Haalt kroegen uit OpenStreetMap en wijken van het CBS voor ${STAD.naam}.</div>
      <div class="btns"><button class="btn primary" data-import>Kroegen en wijken importeren</button></div>
      <div id="terugmeldingen" class="small muted" style="margin-top:10px">Terugmeldingen laden…</div></div>` : ""}
    <div class="btns"><button class="btn quiet" data-logout>Uitloggen</button></div>
    <div class="btns"><button class="btn quiet" data-verwijder>Account verwijderen</button></div>`;
}

function fotoUrl(pad) {
  return sb.storage.from("prijslijsten").getPublicUrl(pad).data.publicUrl;
}

function openFoto(url) {
  const box = $("#lightbox");
  $("#lightboxImg").src = url;
  box.hidden = false;
}

function locatie(timeout = 8000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        state.pos = [p.coords.longitude, p.coords.latitude];
        zorgVoorPositieLaag();
        resolve(state.pos);
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 30000 });
  });
}

async function locatieIndienToegestaan() {
  try {
    if (navigator.permissions?.query) {
      const p = await navigator.permissions.query({ name: "geolocation" });
      if (p.state !== "granted") return state.pos;
    } else return state.pos;
  } catch {
    return state.pos;
  }
  return locatie(4000);
}

function vraag(tekst, ja = "Doorgaan") {
  return new Promise((resolve) => {
    const m = $("#modal");
    $("#modalText").textContent = tekst;
    $("#modalJa").textContent = ja;
    m.hidden = false;
    const klaar = (v) => {
      m.hidden = true;
      $("#modalJa").onclick = null;
      $("#modalNee").onclick = null;
      resolve(v);
    };
    $("#modalJa").onclick = () => klaar(true);
    $("#modalNee").onclick = () => klaar(false);
  });
}

function openKroeg(id) {
  state.selected = Number(id);
  state.form = null;
  state.pagina = null;
  const k = kroegById(state.selected);
  if (k) map.easeTo({ center: [k.lon, k.lat], zoom: Math.max(map.getZoom(), 15.5), duration: 600, padding: wide() ? { left: 400 } : { bottom: innerHeight * 0.45 } });
  kaartBijwerken();
  draw();
  if (!wide()) setDetent("half");
  body.scrollTop = 0;
}

function sluitKroeg() {
  state.selected = null;
  state.form = null;
  state.pagina = null;
  kaartBijwerken();
  draw();
}

function setTab(t) {
  state.tab = t;
  state.selected = null;
  state.form = null;
  state.pagina = null;
  document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === t)));
  kaartBijwerken();
  draw();
  body.scrollTop = 0;
  if (!wide() && sheet.dataset.detent === "peek") setDetent("half");
}

function kiesWijk(naam) {
  state.wijk = naam;
  state.tab = "kaart";
  state.selected = null;
  state.form = null;
  state.pagina = null;
  state.filter = "alles";
  state.limiet = 40;
  document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === "kaart")));
  const ks = state.kroegen.filter((k) => k.wijk === naam);
  if (ks.length && kaartKlaar) {
    const b = new maplibregl.LngLatBounds([ks[0].lon, ks[0].lat], [ks[0].lon, ks[0].lat]);
    ks.forEach((k) => b.extend([k.lon, k.lat]));
    map.fitBounds(b, {
      padding: wide() ? { left: 420, top: 48, bottom: 48, right: 40 } : { top: 80, bottom: innerHeight * 0.45, left: 28, right: 28 },
      maxZoom: 15,
      duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700,
    });
  }
  draw();
  if (!wide()) setDetent("half");
}

async function verkleinFoto(file) {
  if (!file || !file.type.startsWith("image/") || file.type === "image/heic") return file;
  try {
    const bmp = await createImageBitmap(file);
    const max = 1600;
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * scale));
    c.height = Math.max(1, Math.round(bmp.height * scale));
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.82));
    bmp.close?.();
    if (!blob) return file;
    return new File([blob], "prijslijst.jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

async function verstuurPrijs(form) {
  const k = kroegById(state.selected);
  const fd = new FormData(form);
  const merk = fd.get("merk") === "_anders" ? String(fd.get("merkAnders") ?? "").trim() : String(fd.get("merk"));
  const cl = gekozenCl();
  const prijs = Math.round(parseFloat(String(fd.get("prijs")).replace(",", ".")) * 100);
  if (!merk || merk.length < 2) return toast("Vul het merk van het goedkoopste bier in");
  if (!cl) return toast("Kies een glas tussen 15 en 100 cl");
  if (!Number.isFinite(prijs) || prijs < 50 || prijs > 2500) return toast("Vul een prijs tussen €0,50 en €25 in");
  const knop = $("#verstuur");
  knop.disabled = true;
  knop.textContent = "Bezig…";
  try {
    let pos = null;
    if (fd.get("locatie")) pos = await locatie();
    let foto_pad = null;
    const raw = fd.get("foto");
    if (raw && raw.size) {
      const file = await verkleinFoto(raw);
      if (file.size > 5 * 1024 * 1024) throw new Error("Foto is groter dan 5 MB. Kies een kleinere.");
      const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      foto_pad = `${state.sessie.user.id}/${k.id}-${Date.now()}.${ext}`;
      const { error } = await sb.storage.from("prijslijsten").upload(foto_pad, file, { contentType: file.type || "image/jpeg", upsert: false });
      if (error) throw error;
    }
    const { data, error } = await sb.rpc("meld_prijs", {
      p_kroeg_id: k.id, p_merk: merk, p_volume_cl: cl, p_prijs_cent: prijs,
      p_lat: pos?.[1] ?? null, p_lon: pos?.[0] ?? null, p_foto_pad: foto_pad,
    });
    if (error) throw error;
    state.form = null;
    const wasDicht = k.versheid === "locked";
    if (data.status === "bevestigd") {
      const basis = data.soort === "eerst" ? 50 : 30;
      const pt = (data.ter_plaatse ? Math.round(basis * 1.5) : basis) + (data.foto_pad ? 5 : 0);
      toast(data.soort === "eerst" ? `${k.naam} vrijgespeeld` : "Prijs bijgewerkt", pt);
    } else if (data.soort === "eerst") toast(`${k.naam} vrijgespeeld. Punten volgen na bevestiging`);
    else toast("Gemeld. Punten volgen na bevestiging");
    if (wasDicht) vierVrij(k);
    await Promise.all([laadKroegen(), laadStad()]);
    draw();
  } catch (e) {
    toast(await leesFout(e));
    if (knop.isConnected) { knop.disabled = false; knop.textContent = "Versturen"; }
  }
}

async function kloptNog(id) {
  const k = kroegById(id);
  const pos = await locatieIndienToegestaan();
  const { data, error } = await sb.rpc("klopt_nog", { p_kroeg_id: id, p_lat: pos?.[1] ?? null, p_lon: pos?.[0] ?? null });
  if (error) return toast(await leesFout(error));
  const ijk = k?.laatst_gecontroleerd || k?.prijs_sinds;
  const oud = dagen(ijk) != null && dagen(ijk) >= 90;
  let pt = oud ? 15 : 5;
  if (data?.ter_plaatse) pt = Math.round(pt * 1.5);
  toast(oud ? "Oude prijs gecontroleerd" : "Prijs klopt nog", pt);
  vernieuw();
}

async function beoordeel(g, oordeel) {
  if (oordeel === "klopt_niet") {
    const ok = await vraag("Klopt niet? Als twee spelers dat zeggen, wordt de melding weerlegd en verliest de melder 20 punten.", "Weerleggen");
    if (!ok) return;
  }
  const { data, error } = await sb.rpc("beoordeel", { p_gebeurtenis: g, p_oordeel: oordeel });
  if (error) return toast(await leesFout(error));
  const tekst = data === "bevestigd" ? "Bevestigd, de prijs staat erop" : data === "weerlegd" ? "Weerlegd" : "Oordeel opgeslagen. Er is nog een bevestiging nodig";
  toast(tekst, data === "wacht" ? null : 5);
  vernieuw();
}

async function rapporteer(soort) {
  if (!state.sessie) { state.pagina = "login"; draw(); return; }
  const { error } = await sb.from("terugmeldingen").insert({ kroeg_id: state.selected, door_id: state.sessie.user.id, soort });
  if (error) return toast(error.code === "23505" ? "Die melding had je al doorgegeven" : await leesFout(error));
  toast("Doorgegeven. Een beheerder kijkt ernaar.");
}

body.addEventListener("click", (e) => {
  const t = e.target.closest("button, a");
  if (!t || !body.contains(t)) return;
  if (t.dataset.kroeg) return openKroeg(t.dataset.kroeg);
  if (t.dataset.back !== undefined) return sluitKroeg();
  if (t.dataset.cancel !== undefined) { state.form = null; return draw(); }
  if (t.dataset.sluitPagina !== undefined) { state.pagina = null; return draw(); }
  if (t.dataset.filter) { state.filter = t.dataset.filter; state.limiet = 40; return draw(); }
  if (t.dataset.sort) { state.sort = t.dataset.sort; state.limiet = 40; return draw(); }
  if (t.dataset.beeld !== undefined) {
    state.inBeeld = t.getAttribute("aria-pressed") !== "true";
    state.limiet = 40;
    return draw();
  }
  if (t.dataset.wisWijk !== undefined) { state.wijk = null; return draw(); }
  if (t.dataset.wijk) return kiesWijk(t.dataset.wijk);
  if (t.dataset.periode) { state.periode = t.dataset.periode; return rangView(); }
  if (t.dataset.meer !== undefined) { state.limiet += 40; return verversLijst(); }
  if (t.dataset.locateList !== undefined) {
    locatie().then((pos) => { if (!pos) toast("Locatie niet beschikbaar"); draw(); });
    return;
  }
  if (t.dataset.login !== undefined) {
    state.pagina = "login";
    state.form = null;
    draw();
    if (!wide()) setDetent("full");
    return;
  }
  if (t.dataset.regels !== undefined) {
    state.pagina = "regels";
    state.selected = null;
    state.form = null;
    return draw();
  }
  if (t.dataset.intro !== undefined) { $("#intro").hidden = false; return; }
  if (t.dataset.form) {
    const k = kroegById(state.selected);
    const cl = k?.huidig_volume_cl ?? 25;
    const bekend = GLAZEN.some((g) => g.cl === cl);
    state.form = { merk: k?.huidig_merk || "Heineken", cl: bekend ? cl : cl, clAnders: !bekend && !!k?.huidig_volume_cl, prijs: "" };
    draw();
    if (!wide()) setDetent("full");
    return;
  }
  if (t.dataset.cl) {
    const anders = t.dataset.cl === "anders";
    state.form.clAnders = anders;
    if (!anders) state.form.cl = Number(t.dataset.cl);
    body.querySelectorAll(".seg button[data-cl]").forEach((b) => b.setAttribute("aria-pressed", String(b === t)));
    const veld = body.querySelector("[name=clAnders]");
    if (veld) veld.hidden = !anders;
    updatePrijsPreview();
    return;
  }
  if (t.dataset.klopt) return kloptNog(Number(t.dataset.klopt));
  if (t.dataset.oordeel) return beoordeel(Number(t.dataset.g), t.dataset.oordeel);
  if (t.dataset.rapport) return rapporteer(t.dataset.rapport);
  if (t.dataset.foto) return openFoto(t.dataset.foto);
  if (t.dataset.logout !== undefined) return sb.auth.signOut();
  if (t.dataset.verwijder !== undefined) return verwijderAccount();
  if (t.dataset.import !== undefined) return importeer(t);
});

body.addEventListener("input", (e) => {
  if (e.target.matches("[data-zoek]")) {
    state.zoek = e.target.value;
    verversLijst();
    return;
  }
  if (e.target.name === "merk") {
    const anders = body.querySelector("[name=merkAnders]");
    if (anders) anders.style.display = e.target.value === "_anders" ? "" : "none";
  }
  if (e.target.name === "prijs" || e.target.name === "clAnders" || e.target.name === "merk") updatePrijsPreview();
});

body.addEventListener("change", (e) => {
  if (e.target.name !== "foto" || !e.target.files?.[0]) return;
  const img = $("#fotoPreview");
  if (!img) return;
  img.src = URL.createObjectURL(e.target.files[0]);
  img.hidden = false;
});

body.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === "prijsForm") return verstuurPrijs(f);
  if (f.id === "loginForm") {
    const fd = new FormData(f);
    const naam = String(fd.get("naam") || "").trim();
    if (naam && naam.length < 2) return toast("Kies een langere spelersnaam, of laat het veld leeg");
    const options = { emailRedirectTo: location.origin + location.pathname };
    if (naam) options.data = { naam };
    const { error } = await sb.auth.signInWithOtp({ email: String(fd.get("email")), options });
    if (error) return toast(await leesFout(error));
    f.innerHTML = `<div class="card"><b>Check je mail</b><p class="small">Tik op de link in het bericht en open hem in deze browser. Niets gezien? Kijk in spam.</p></div>`;
  }
  if (f.id === "naamForm") {
    const naam = String(new FormData(f).get("naam")).trim();
    const { error } = await sb.from("profielen").update({ naam }).eq("id", state.sessie.user.id);
    if (error) return toast(error.code === "23505" ? "Die naam is al bezet" : await leesFout(error));
    toast("Naam opgeslagen");
    await laadProfiel();
    draw();
  }
});

async function importeer(knop) {
  knop.disabled = true;
  knop.textContent = "Bezig met importeren…";
  const { data, error } = await sb.functions.invoke("osm-import", { body: { gemeente: STAD.naam, gemeentecode: STAD.gemeentecode } });
  knop.disabled = false;
  knop.textContent = "Kroegen en wijken importeren";
  if (error) return toast("Import mislukt: " + await leesFout(error));
  toast(`${data.kroegen} kroegen en ${data.wijken} wijken geïmporteerd`);
  vernieuw();
}

async function verwijderAccount() {
  const ok = await vraag("Je account, naam en punten verdwijnen. Prijzen die je meldde blijven staan, zonder jouw naam. Dit kan niet ongedaan.", "Account verwijderen");
  if (!ok) return;
  const { error } = await sb.functions.invoke("account-verwijderen", { body: {} });
  if (error) return toast(await leesFout(error));
  await sb.auth.signOut();
  toast("Account verwijderd");
}

async function laadTerugmeldingen() {
  const el = $("#terugmeldingen");
  if (!el) return;
  const { data, error } = await sb.from("terugmeldingen").select("id,soort,op,kroeg_id").order("op", { ascending: false }).limit(12);
  if (error) { el.textContent = "Terugmeldingen laden mislukt. Staat de migratie al op de database?"; return; }
  if (!data?.length) { el.textContent = "Geen terugmeldingen."; return; }
  const label = { dicht: "dicht", verkeerde_plek: "verkeerde plek", duplicaat: "dubbel" };
  el.innerHTML = data.map((r) => {
    const k = kroegById(r.kroeg_id);
    return `<div>${esc(k?.naam || "Kroeg " + r.kroeg_id)} · ${label[r.soort] || esc(r.soort)} · ${wanneer(r.op)}</div>`;
  }).join("");
}

$("#tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b?.dataset.tab) setTab(b.dataset.tab); });
$("#locate").addEventListener("click", async () => {
  const pos = await locatie();
  if (!pos) return toast("Locatie niet beschikbaar");
  map.easeTo({ center: pos, zoom: 16 });
  if (state.tab === "kaart" && state.selected == null) draw();
});
$("#lightboxSluit").addEventListener("click", () => { $("#lightbox").hidden = true; $("#lightboxImg").removeAttribute("src"); });
$("#lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") $("#lightboxSluit").click(); });
$("#introOk").addEventListener("click", () => {
  $("#intro").hidden = true;
  try { localStorage.setItem(INTRO_SLEUTEL, "1"); } catch { /* privémodus */ }
});
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") $("#modalNee").click(); });

sb.channel("stad")
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "gebeurtenissen" }, (p) => {
    if (p.new.door_id !== state.sessie?.user?.id && String(state.selected) === String(p.new.kroeg_id)) {
      const k = kroegById(p.new.kroeg_id);
      if (k) toast(p.new.soort === "check" ? `${k.naam} is net gecontroleerd` : `Nieuwe prijs bij ${k.naam}`);
    }
    vernieuw();
  })
  .on("postgres_changes", { event: "UPDATE", schema: "public", table: "gebeurtenissen" }, () => vernieuw())
  .on("postgres_changes", { event: "*", schema: "public", table: "kroegen" }, () => vernieuw())
  .subscribe();

sb.auth.onAuthStateChange(async (_e, sessie) => {
  state.sessie = sessie;
  await laadProfiel();
  if (state.pagina === "login" && sessie) state.pagina = null;
  draw();
});

(async function start() {
  const { data } = await sb.auth.getSession();
  state.sessie = data.session;
  await Promise.all([laadKroegen(), laadStad(), laadProfiel()]);
  draw();
  setDetent("half");
  let gezien = false;
  try { gezien = localStorage.getItem(INTRO_SLEUTEL) === "1"; } catch { gezien = true; }
  if (!gezien) $("#intro").hidden = false;
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
