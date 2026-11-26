// Bierkoers op Cloudflare Pages: een bewaarkopie van de sessie in een HttpOnly-cookie, zodat een speler (ook zonder
// account) terugkomt als de browser zijn opslag wist. Safari wist opslag van een website na 7 dagen zonder bezoek
// (niet in de app op het beginscherm); een cookie die de server zet, valt daar niet onder. Zelfde idee als DBDB.
// Verder vult dit bestand de pagina voor zoekmachines en AI-zoekers (zie zoekmachine() hieronder); de rest van de app
// zijn gewone bestanden.
//
// PUT    { refresh_token }  bewaar de vernieuwingssleutel van de huidige sessie in de cookie
// POST                      herstel: vernieuw de sessie bij Supabase met de cookie en geef hem terug
//                           (204 zonder inhoud als er geen cookie is: dat is geen fout, gewoon een nieuwe bezoeker)
// DELETE                    wis de cookie (uitloggen)

// Gelijk aan app/config.js: openbare instellingen, geen geheimen
const SUPABASE_URL = "https://yzaootlrhxzyxtvacrot.supabase.co";
const SUPABASE_KEY = "sb_publishable_Nc0p9wvcJJWZN6rRYiBOyA_2QW3IPKs";
const KOEK = "bk_sessie";
const BEWAAR = 400 * 24 * 3600; // Chrome bewaart een cookie hooguit 400 dagen; bij elk bezoek zetten we hem opnieuw

function koek(waarde, maxAge) {
  return `${KOEK}=${waarde}; Max-Age=${maxAge}; Path=/api/sessie; HttpOnly; Secure; SameSite=Strict`;
}

function antwoord(status, body = null, cookie = null) {
  const headers = { "Cache-Control": "no-store" };
  if (body) headers["Content-Type"] = "application/json";
  if (cookie) headers["Set-Cookie"] = cookie;
  return new Response(body ? JSON.stringify(body) : null, { status, headers });
}

const geldig = (t) => typeof t === "string" && t.length >= 8 && t.length <= 2048 && /^[A-Za-z0-9._-]+$/.test(t);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/sessie") return zoekmachine(request, env, url);
    // Alleen de app zelf: een andere website mag deze cookie niet zetten of uitlezen
    if (request.headers.get("Origin") !== url.origin) return antwoord(403, { fout: "Niet toegestaan" });

    if (request.method === "PUT") {
      const { refresh_token } = await request.json().catch(() => ({}));
      if (!geldig(refresh_token)) return antwoord(400, { fout: "Geen geldige sessie" });
      return antwoord(204, null, koek(refresh_token, BEWAAR));
    }
    if (request.method === "DELETE") return antwoord(204, null, koek("", 0));
    if (request.method !== "POST") return antwoord(405, { fout: "Niet toegestaan" });

    const token = (request.headers.get("Cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(KOEK + "="))?.slice(KOEK.length + 1);
    if (!geldig(token)) return antwoord(204);
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: token }),
    });
    // Sleutel verlopen, ingetrokken of al gebruikt: cookie weg. Bij een storing bij Supabase houden we hem.
    if (r.status >= 400 && r.status < 500) return antwoord(401, { fout: "Sessie verlopen" }, koek("", 0));
    if (!r.ok) return antwoord(502, { fout: "Supabase gaf geen antwoord" });
    const sessie = await r.json();
    return antwoord(200, sessie, geldig(sessie.refresh_token) ? koek(sessie.refresh_token, BEWAAR) : null);
  },
};

// ---------------------------------------------------------------------------
// Zoekmachines en AI-zoekers
// ---------------------------------------------------------------------------
// De app bouwt zijn scherm in de browser op, dus een crawler zonder JavaScript zag geen prijs. Voor / en voor het adres
// van elke stad met prijzen (/utrecht) zet deze werker dezelfde stadsprijzen als gewone tekst in de HTML, met titel,
// beschrijving en JSON-LD. Bezoekers zien dezelfde app: die vervangt de tekst zodra hij laadt, en /utrecht opent de
// app ingezoomd op Utrecht. Verder: robots.txt, sitemap.xml en llms.txt. Alles komt uit dezelfde openbare data als de app.

const SITE = "https://bierkoers.nl";
const MIN_PRIJZEN = 3; // een stad krijgt een eigen adres en tekst zodra zoveel kroegen een prijs hebben
const AI_BOTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "PerplexityBot", "Google-Extended"];

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const euro = (cent) => `€ ${(cent / 100).toFixed(2).replace(".", ",")}`;
const slug = (naam) => naam.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const datum = (iso) => new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" });
const mediaan = (lijst) => { const s = [...lijst].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

// De steden met genoeg prijzen: Pilsindex (mediaan per vaasje van 25 cl) en de goedkoopste kroegen. Een uur gecachet.
async function laadSteden() {
  const rijen = [];
  try {
    for (let van = 0; van < 5000; van += 1000) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/kroeg_kaart?select=naam,gemeente,per25_cent,laatst_gecontroleerd&open=eq.true&per25_cent=not.is.null&order=gemeente,per25_cent,naam`, {
        headers: { apikey: SUPABASE_KEY, Range: `${van}-${van + 999}` },
        cf: { cacheTtl: 3600, cacheEverything: true },
      });
      if (!r.ok) break;
      const deel = await r.json();
      rijen.push(...deel);
      if (deel.length < 1000) break;
    }
  } catch { /* zonder data blijft de pagina gewoon de app */ }
  const perStad = new Map();
  for (const k of rijen) perStad.set(k.gemeente, [...(perStad.get(k.gemeente) ?? []), k]);
  return [...perStad]
    .filter(([, l]) => l.length >= MIN_PRIJZEN)
    .map(([naam, l]) => ({
      naam, slug: slug(naam), n: l.length, index: mediaan(l.map((k) => k.per25_cent)),
      goedkoopst: l.slice(0, 10).map((k) => ({ naam: k.naam, prijs: k.per25_cent })),
      bijgewerkt: l.map((k) => k.laatst_gecontroleerd).filter(Boolean).sort().pop() ?? null,
    }))
    .sort((a, b) => b.n - a.n || a.naam.localeCompare(b.naam));
}

const kroegenTekst = (s, aantal) => s.goedkoopst.slice(0, aantal).map((k) => `${k.naam} ${euro(k.prijs)}`).join(", ");

function paginaInhoud(steden, stad) {
  const lijst = (s, aantal) => `<ul>${s.goedkoopst.slice(0, aantal).map((k) => `<li>${esc(k.naam)}: ${euro(k.prijs)}</li>`).join("")}</ul>`;
  const anderen = steden.filter((s) => s !== stad).map((s) => `<a href="/${s.slug}">${esc(s.naam)}</a>`).join(", ");
  if (stad) {
    return `<div id="seo-inhoud"><h1>Bierprijs ${esc(stad.naam)}</h1>
<p>Een vaasje pils (25 cl, van de tap) kost in ${esc(stad.naam)} gemiddeld ${euro(stad.index)}. Dat is de Pilsindex van ${esc(stad.naam)}: de mediaan van de goedkoopste pils in ${stad.n} kroegen${stad.bijgewerkt ? `, bijgewerkt op ${datum(stad.bijgewerkt)}` : ""}.</p>
<h2>Goedkoopste pils in ${esc(stad.naam)}</h2>${lijst(stad, 10)}
<p>De prijzen worden door spelers en van menukaarten verzameld en gecontroleerd. Tik op de kaart voor alle kroegen.</p>${anderen ? `<p>Ook: ${anderen}.</p>` : ""}</div>`;
  }
  if (!steden.length) return "";
  return `<div id="seo-inhoud"><h1>Bierkoers: wat kost een biertje?</h1>
<p>De prijs van de goedkoopste pils van de tap in een vaasje (25 cl), per kroeg, samen bijgehouden als een beurs.</p>
${steden.map((s) => `<h2><a href="/${s.slug}">Bierprijs ${esc(s.naam)}</a></h2><p>Pilsindex ${euro(s.index)} in ${s.n} kroegen. Goedkoopst: ${esc(kroegenTekst(s, 3))}.</p>`).join("")}</div>`;
}

function jsonLd(steden, stad) {
  const gebieden = stad ? [stad] : steden;
  const graph = [
    { "@type": "WebSite", "@id": `${SITE}/#site`, name: "Bierkoers", url: `${SITE}/`, inLanguage: "nl" },
    { "@type": "Organization", "@id": `${SITE}/#bierkoers`, name: "Bierkoers", url: `${SITE}/`, logo: `${SITE}/icon-512.png` },
  ];
  if (gebieden.length) {
    const nieuwste = gebieden.map((s) => s.bijgewerkt).filter(Boolean).sort().pop();
    graph.push({
      "@type": "Dataset",
      name: stad ? `Bierprijzen per kroeg in ${stad.naam}` : "Bierprijzen per kroeg",
      description: `De prijs van de goedkoopste pils van de tap per vaasje (25 cl) in kroegen in ${gebieden.map((s) => s.naam).join(", ")}, door spelers en van menukaarten verzameld.`,
      url: stad ? `${SITE}/${stad.slug}` : `${SITE}/`,
      inLanguage: "nl",
      isAccessibleForFree: true,
      creator: { "@id": `${SITE}/#bierkoers` },
      ...(nieuwste ? { dateModified: nieuwste } : {}),
      spatialCoverage: gebieden.map((s) => ({ "@type": "Place", name: s.naam })),
      variableMeasured: gebieden.map((s) => ({ "@type": "PropertyValue", name: `Pilsindex ${s.naam} (mediaan prijs van een vaasje pils, 25 cl)`, value: s.index / 100, unitText: "EUR" })),
    });
  }
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
}

async function appPagina(request, env, url, steden, stad) {
  const bron = await env.ASSETS.fetch(new Request(`${url.origin}/`, { headers: request.headers }));
  if (!bron.ok || !steden.length) return bron;
  const titel = stad
    ? `Bierprijs ${stad.naam}: Pilsindex ${euro(stad.index)} | Bierkoers`
    : `Bierkoers: wat kost een biertje? Bierprijzen per kroeg in ${steden.slice(0, 3).map((s) => s.naam).join(", ")}`;
  const beschrijving = stad
    ? `Een vaasje pils kost in ${stad.naam} gemiddeld ${euro(stad.index)} (Pilsindex, ${stad.n} kroegen${stad.bijgewerkt ? `, bijgewerkt op ${datum(stad.bijgewerkt)}` : ""}). Goedkoopst: ${kroegenTekst(stad, 3)}.`
    : `De prijs van een vaasje pils per kroeg, samen bijgehouden. ${steden.slice(0, 3).map((s) => `${s.naam}: Pilsindex ${euro(s.index)}`).join(". ")}.`;
  const adres = `${SITE}${stad ? `/${stad.slug}` : "/"}`;
  const zet = (naam, waarde) => ({ element: (e) => e.setAttribute(naam, waarde) });
  const kop = new HTMLRewriter()
    .on("title", { element: (e) => e.setInnerContent(titel) })
    .on('meta[name="description"]', zet("content", beschrijving))
    .on('meta[property="og:title"]', zet("content", titel))
    .on('meta[property="og:description"]', zet("content", beschrijving))
    .on('meta[property="og:url"]', zet("content", adres))
    .on('link[rel="canonical"]', zet("href", adres))
    .on("head", { element: (e) => e.append(`${stad ? `<script>window.BK_STAD=${JSON.stringify(stad.naam)}</script>` : ""}<script type="application/ld+json">${jsonLd(steden, stad)}</script>`, { html: true }) })
    .on("#body", { element: (e) => e.setInnerContent(paginaInhoud(steden, stad), { html: true }) })
    .transform(bron);
  const headers = new Headers(kop.headers);
  headers.set("Cache-Control", "public, max-age=300");
  return new Response(kop.body, { status: 200, headers });
}

const tekst = (inhoud, type) => new Response(inhoud, { headers: { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "public, max-age=3600" } });

async function zoekmachine(request, env, url) {
  const pad = url.pathname;
  if (request.method !== "GET" && request.method !== "HEAD") return env.ASSETS.fetch(request);
  if (pad === "/robots.txt") {
    return tekst(`User-agent: *\nAllow: /\nDisallow: /api/\n\n${AI_BOTS.map((b) => `User-agent: ${b}\nAllow: /\n`).join("\n")}\nSitemap: ${SITE}/sitemap.xml\n`, "text/plain");
  }
  const naam = pad.replace(/^\/|\/$/g, "").toLowerCase();
  const kandidaat = pad === "/" || pad === "/sitemap.xml" || pad === "/llms.txt" || /^\/[a-z0-9-]+\/?$/.test(pad) && !pad.includes(".");
  if (!kandidaat) return env.ASSETS.fetch(request);
  const steden = await laadSteden();
  if (pad === "/sitemap.xml") {
    const iso = (d) => (d ? `<lastmod>${new Date(d).toISOString().slice(0, 10)}</lastmod>` : "");
    const nieuwste = steden.map((s) => s.bijgewerkt).filter(Boolean).sort().pop();
    const urls = [`<url><loc>${SITE}/</loc>${iso(nieuwste)}</url>`, ...steden.map((s) => `<url><loc>${SITE}/${s.slug}</loc>${iso(s.bijgewerkt)}</url>`), `<url><loc>${SITE}/privacy</loc></url>`];
    return tekst(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`, "application/xml");
  }
  if (pad === "/llms.txt") {
    return tekst(`# Bierkoers

> Bierkoers (bierkoers.nl) toont wat de goedkoopste pils van de tap kost in kroegen, als een beurs. Spelers en menukaarten leveren de prijzen, spelers houden ze vers. De Pilsindex van een stad is de mediaan van de prijs van een vaasje (25 cl) in kroegen met een prijs.

## Steden met prijzen
${steden.length ? steden.map((s) => `- [Bierprijs ${s.naam}](${SITE}/${s.slug}): Pilsindex ${euro(s.index)}, ${s.n} kroegen${s.bijgewerkt ? `, bijgewerkt op ${datum(s.bijgewerkt)}` : ""}`).join("\n") : "- Nog geen stad met genoeg prijzen."}

## Overig
- [Bierkoers](${SITE}/): de kaart met alle kroegen en prijzen
- [Privacy](${SITE}/privacy)
`, "text/plain");
  }
  if (pad !== "/" && pad.endsWith("/")) return Response.redirect(`${url.origin}/${naam}${url.search}`, 301);
  if (pad === "/") return appPagina(request, env, url, steden, null);
  const stad = steden.find((s) => s.slug === naam);
  return stad ? appPagina(request, env, url, steden, stad) : env.ASSETS.fetch(request);
}
