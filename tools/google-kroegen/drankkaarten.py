#!/usr/bin/env python3
"""Drankkaarten van eigen websites (DAEN-methode) voor een hele stad, met DeepSeek als lezer.

Stappen (elk schrijft naar nakijken/<datum>-<stad>/, niet in Git):
  kroegen   open kroegen zonder prijs uit de database (openbaar) en hun website uit OpenStreetMap of, als
            google-kroegen-<stad>.json er is (cli.mjs), uit Google Maps
  crawl     per website de startpagina en links met menu, kaart, drank, bier of pdf; pdf's met pdftotext; weinig
            tekst: nog een keer met Playwright (render.mjs); afbeeldingen van de drankkaart als jpg
  lees      DeepSeek leest per kroeg alles en geeft alle bieren van het vat (soort, maat, prijs, regel, datum)
  kies      kandidaten volgens de regels (pils van het vat, 25 cl; zonder maat als het het gewone glas is, zie kies_zonder_maat)
  gevallen  per kandidaat een map met geval.json en, bij een pdf, uitsnede.jpg en foto.jpg voor het nakijken
  datum     (na het nakijken) per goedgekeurd geval de datum van de kaart zelf, de vaste controles en import.json

Gebruik: python3 drankkaarten.py <stad> [stap ...] [--extra extra-websites.json]
Zonder stap draaien de stappen tot en met gevallen. Nakijken daarna met deepseek-controleur.mjs, dan de stap
datum; import.json gaat naar importeer_menuprijzen (zie docs/menukaartprijzen.md). Vanuit een cloudsessie voegt de proxy de DeepSeek-sleutel
toe; zet anders DEEPSEEK_API_KEY.
"""
import concurrent.futures as cf, datetime, glob, html, json, os, re, shutil, statistics, subprocess, sys, time
import urllib.error, urllib.parse, urllib.request

HIER = os.path.dirname(os.path.abspath(__file__))
SUPABASE = "https://yzaootlrhxzyxtvacrot.supabase.co/rest/v1"
SLEUTEL = re.search(r'SUPABASE_KEY = "([^"]+)"', open(os.path.join(HIER, "../../app/config.js")).read()).group(1)
UA = {"User-Agent": "Mozilla/5.0 (Bierkoers drankkaart; +https://bierkoers.nl)"}
GEEN_SITE = re.compile(r"facebook\.com|instagram\.com|nlcompanies|tripadvisor|thefork|google\.|linktr\.ee|wa\.me", re.I)
BEELD = re.compile(r"\.(jpe?g|png|webp)(\?|$)", re.I)
LINK = re.compile(r"menu|kaart|drank|drink|bier|beer|tap|vat|prijs|price|carte|boisson|\.pdf", re.I)
MODEL = os.environ.get("MENU_MODEL", "deepseek-flash")
MODEL_URL = os.environ.get("MENU_MODEL_URL", "https://api.deepseek.com")

OPDRACHT = """Je leest de teksten van de website van een kroeg in Nederland of België: pagina's en drankkaarten (pdf), elk met een nummer [D1], [D2], ...
Een document met "[afbeelding]" is een foto of plaatje van de website; lees de kaart op die afbeelding.
Zoek ALLE bieren van het vat (tap, draft, draught, "van 't vat", "op tap"). Geen flessen of blikjes. Staat een bier onder een kop als "van 't vat", "on tap" of "draft", dan is het van het vat. Is het niet duidelijk, zet "tap": null.
Geef per bier: naam zoals op de kaart, soort (pils, blond, tripel, dubbel, wit, ipa, amber, bruin, stout, kriek/fruit, cider, alcoholvrij of anders), maat in cl (null als die er niet staat; "vaasje" of "vaas" is 25 cl, "fluitje" 18 tot 22 cl), prijs in euro voor die maat, of het een actieprijs is (happy hour, dagaanbieding), het nummer van het document en de regel letterlijk.
Staan er meer maten (25cl / 50cl met 3,00 / 6,00), maak dan per maat een regel.
Noem ook datumaanwijzingen: een datum op de kaart, in de titel of bestandsnaam, de pdf-datum (CreationDate, ModDate) of Last-Modified die bovenaan het document staat.
Verzin niets. Antwoord alleen met JSON:
{"is_drankkaart": true, "tapbieren": [{"naam": "...", "soort": "pils", "cl": 25, "prijs": 3.0, "tap": true, "actie": false, "doc": 1, "regel": "..."}], "datum_aanwijzingen": [{"doc": 1, "tekst": "..."}], "opmerking": "kort"}"""


def haal(url, maxb=6_000_000, json_=False, headers=None, pogingen=4):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    for poging in range(pogingen):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read(maxb)
                return json.loads(data) if json_ else (data, r.headers.get("Content-Type", ""), r.headers.get("Last-Modified"), r.geturl())
        except urllib.error.HTTPError as e:
            if e.code not in (429, 503) or poging == pogingen - 1: raise
            time.sleep(10 * (poging + 1))  # te veel verzoeken: even wachten en opnieuw


def rest(pad):
    return haal(f"{SUPABASE}/{pad}", json_=True, headers={"apikey": SLEUTEL})


def stap_kroegen(stad, map_, extra):
    k = rest(f"kroegen?select=id,naam,osm_id,adres,google_place_id&gemeente=eq.{urllib.parse.quote(stad)}&open=is.true&huidig_prijs_cent=is.null&order=id")
    # Ook geen openstaande melding (zoals importeer_menuprijzen): een menukaartprijs wacht op een speler
    wacht = {r["id"] for r in rest(f"kroeg_kaart?select=id&gemeente=eq.{urllib.parse.quote(stad)}&open_melding_id=not.is.null")}
    k = [x for x in k if x["id"] not in wacht]
    tags = {}
    for soort in ("node", "way", "relation"):
        ids = [x["osm_id"].split("/")[1] for x in k if (x["osm_id"] or "").startswith(soort + "/")]
        for i in range(0, len(ids), 50):
            # De OSM-API vraagt een herkenbare user-agent en rustig tempo
            for e in haal(f"https://api.openstreetmap.org/api/0.6/{soort}s.json?{soort}s={','.join(ids[i:i + 50])}", json_=True,
                          headers={"User-Agent": "Bierkoers kroegimport (https://bierkoers.nl)"}, pogingen=6)["elements"]:
                tags[f"{soort}/{e['id']}"] = e.get("tags", {})
            time.sleep(3)
    extra = json.load(open(extra)) if extra else {}
    google = {}
    gbestand = os.path.join(HIER, f"google-kroegen-{re.sub(r'[^a-z0-9]+', '-', stad.lower()).strip('-')}.json")
    if os.path.exists(gbestand):
        g = json.load(open(gbestand)); g = g.get("kroegen", g) if isinstance(g, dict) else g
        google = {x["place_id"]: x.get("website") for x in g if x.get("website") and not GEEN_SITE.search(x["website"])}
    for x in k:
        t = tags.get(x["osm_id"] or "", {})
        x["website"] = extra.get(str(x["id"])) or t.get("website") or t.get("contact:website") or t.get("url") or t.get("website:menu") \
            or google.get(x.get("google_place_id") or "")
    json.dump(k, open(f"{map_}/kroegen.json", "w"), ensure_ascii=False, indent=0)
    print(f"{len(k)} kroegen zonder prijs, {sum(1 for x in k if x['website'])} met een website")


def tekst_van(data, soort, pad):
    if "pdf" in soort or data[:4] == b"%PDF":
        open(pad + ".pdf", "wb").write(data)
        info = subprocess.run(["pdfinfo", pad + ".pdf"], capture_output=True, text=True).stdout
        return info + subprocess.run(["pdftotext", "-layout", pad + ".pdf", "-"], capture_output=True, text=True).stdout
    h = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", data.decode("utf-8", "ignore"), flags=re.S | re.I)
    t = html.unescape(re.sub(r"<[^>]+>", " ", re.sub(r"<br\s*/?>|</(p|div|li|tr|h\d)>", "\n", h, flags=re.I)))
    return "\n".join(re.sub(r"[ \t]+", " ", l).strip() for l in t.splitlines() if l.strip())


def render(url):
    """HTML na JavaScript (Playwright, render.mjs), of None."""
    try:
        r = subprocess.run(["node", os.path.join(HIER, "render.mjs"), url], capture_output=True, timeout=90, env={**os.environ, "NODE_NO_WARNINGS": "1"})
        return r.stdout if len(r.stdout) > 500 else None
    except Exception:
        return None


def zichtbaar(data):
    return len(tekst_van(data, "text/html", "/dev/null")) if data else 0


def beelden_van(pagina_url, data, label_ok):
    """Afbeeldingen die op een drankkaart lijken: in de naam of alt-tekst, of alle grote op een pagina met menu of kaart."""
    uit = []
    for tag in re.findall(r"<img[^>]+>", data.decode("utf-8", "ignore"), re.I):
        src = re.search(r'(?:data-src|src)=["\']([^"\']+)["\']', tag); alt = re.search(r'alt=["\']([^"\']*)["\']', tag)
        srcset = re.search(r'srcset=["\']([^"\']+)["\']', tag)
        if srcset: src_ = srcset[1].split(",")[-1].strip().split(" ")[0]
        elif src: src_ = src[1]
        else: continue
        u = urllib.parse.urljoin(pagina_url, src_)
        if not u.startswith("http") or re.search(r"logo|icon|favicon|sprite|avatar", u, re.I): continue
        if LINK.search(u.rsplit("/", 1)[-1]) or (alt and LINK.search(alt[1])) or label_ok:
            uit.append(u)
    return list(dict.fromkeys(uit))


def bewaar_beeld(data, pad):
    """Afbeelding als jpg van hoogstens 1600 px; None als hij te klein is voor een kaart."""
    from PIL import Image
    import io
    try:
        im = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception:
        return False
    if im.width * im.height < 250_000: return False
    im.thumbnail((1600, 1600)); im.save(pad, quality=85)
    return True


def crawl_een(x, map_):
    url = x["website"] if x["website"].startswith("http") else "https://" + x["website"]
    try:
        data, soort, lm, echt = haal(url)
    except Exception as e:
        data = render(url)
        if not data: return x["id"], f"fout: {str(e)[:80]}"
        soort, lm, echt = "text/html", None, url
    if "html" in soort and zichtbaar(data) < 1500:
        data = render(echt) or data
    paginas = [(echt, data, soort, lm)]
    host = urllib.parse.urlparse(echt).netloc.replace("www.", "")
    links = []
    for href, label in re.findall(r'<a[^>]+href=["\']([^"\'#]+)["\'][^>]*>(.*?)</a>', data.decode("utf-8", "ignore"), re.S | re.I):
        u = urllib.parse.urljoin(echt, href.strip())
        if u.startswith("http") and (LINK.search(u) or LINK.search(re.sub(r"<[^>]+>", " ", label))) \
                and (urllib.parse.urlparse(u).netloc.replace("www.", "") == host or u.lower().split("?")[0].endswith(".pdf")):
            links.append(u)
    beelden = beelden_van(echt, data, False)
    for u in list(dict.fromkeys(links))[:12]:
        try:
            d, s, l = haal(u)[:3]
            if "html" in s and zichtbaar(d) < 800: d = render(u) or d
            paginas.append((u, d, s, l))
            if "html" in s: beelden += beelden_van(u, d, True)
        except Exception:
            pass
    i = 0
    for u, d, s, l in paginas:
        basis = f"{map_}/sites/{x['id']}-{i:02d}"
        open(basis + ".txt", "w").write(f"{u}\nLast-Modified: {l or '-'}\n{tekst_van(d, s, basis)}"); i += 1
    n = 0
    for u in list(dict.fromkeys(beelden))[:30]:
        if n >= 6: break
        try:
            d, s, l = haal(u)[:3]
        except Exception:
            continue
        basis = f"{map_}/sites/{x['id']}-{i:02d}"
        if bewaar_beeld(d, basis + ".jpg"):
            open(basis + ".txt", "w").write(f"{u}\nLast-Modified: {l or '-'}\n[afbeelding, zie de bijlage]"); i += 1; n += 1
    return x["id"], f"{len(paginas)} pagina's, {n} afbeeldingen"


def stap_crawl(map_):
    os.makedirs(f"{map_}/sites", exist_ok=True)
    k = [x for x in json.load(open(f"{map_}/kroegen.json")) if x["website"]]
    with cf.ThreadPoolExecutor(8) as ex:
        uit = list(ex.map(lambda x: crawl_een(x, map_), k))
    print(f"{len(uit)} sites, {sum(1 for _, r in uit if r.startswith('fout'))} met een fout")


def lees_een(kid, naam, map_):
    import base64
    bestanden = sorted(glob.glob(f"{map_}/sites/{kid}-*.txt"))
    docs = [open(f, errors="ignore").read()[:40000] for f in bestanden]
    if not docs:
        return None
    inhoud = [{"type": "text", "text": f"Kroeg: {naam}"}]
    ruimte = 150000
    for i, (f, d) in enumerate(zip(bestanden, docs)):
        stuk = f"[D{i + 1}] {d}"[:ruimte]; ruimte -= len(stuk)
        inhoud.append({"type": "text", "text": stuk})
        if os.path.exists(f[:-4] + ".jpg"):
            inhoud.append({"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(open(f[:-4] + ".jpg", "rb").read()).decode()}})
    if not any(c["type"] == "image_url" for c in inhoud):
        inhoud = "\n\n".join(c["text"] for c in inhoud)
    body = {"model": MODEL, "temperature": 0, "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": OPDRACHT}, {"role": "user", "content": inhoud}]}
    req = urllib.request.Request(f"{MODEL_URL}/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {os.environ.get('DEEPSEEK_API_KEY', 'via-proxy')}"})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=300))
        uit = json.loads(d["choices"][0]["message"]["content"])
        uit["_bronnen"] = [doc.split("\n", 1)[0] for doc in docs]
        uit["_tokens"] = [d["usage"].get("prompt_tokens"), d["usage"].get("completion_tokens")]
        return uit
    except Exception as e:
        return {"fout": str(e)[:200]}


def stap_lees(map_):
    k = {x["id"]: x["naam"] for x in json.load(open(f"{map_}/kroegen.json"))}
    with cf.ThreadPoolExecutor(6) as ex:
        uit = dict(zip(k, ex.map(lambda kid: lees_een(kid, k[kid], map_), k)))
    uit = {str(kid): {"naam": k[kid], **v} for kid, v in uit.items() if v}
    json.dump(uit, open(f"{map_}/deepseek.json", "w"), ensure_ascii=False, indent=1)
    tok = [v.get("_tokens", [0, 0]) for v in uit.values()]
    print(f"{len(uit)} kroegen gelezen, {sum(1 for v in uit.values() if 'fout' in v)} fouten, tokens in/uit {sum(t[0] or 0 for t in tok)}/{sum(t[1] or 0 for t in tok)}")


def index_van(stad):
    """Pilsindex van de stad (mediaan per 25 cl van bevestigde en menukaartprijzen), of None bij minder dan 5."""
    rij = rest(f"kroeg_tijdlijn?select=kroeg_id,prijs_cent,volume_cl,op,status,bron&gemeente=eq.{urllib.parse.quote(stad)}&soort=neq.check&order=op")
    laatst = {r["kroeg_id"]: r["prijs_cent"] * 25 / r["volume_cl"] for r in rij if r["volume_cl"] and (r["status"] == "bevestigd" or r["bron"] == "menukaart")}
    return statistics.median(laatst.values()) / 100 if len(laatst) >= 5 else None


def kies_zonder_maat(pils, index, belgie):
    """Pils van het vat zonder maat als 25 cl, als het het gewone glas is: er staat maar een prijs zonder maat bij dat bier
    en (a) de kaart noemt het kleinere glas (fluitje) en/of een groter glas apart, met de prijs ertussen, of (b) de prijs ligt
    binnen 15% van de Pilsindex van de stad (zonder index in de stad: van het land). In Belgie is dat glas het pintje."""
    zonder = [b for b in pils if b.get("cl") is None and b.get("tap") is not False]
    if not zonder: return None
    if len({b["prijs"] for b in zonder}) > 1: return None  # meer prijzen zonder maat: welk glas is welk?
    b = zonder[0]
    klein = [x["prijs"] for x in pils if x.get("cl") and x["cl"] < 25]
    groot = [x["prijs"] for x in pils if x.get("cl") and x["cl"] >= 33]
    if (klein or groot) and all(p < b["prijs"] for p in klein) and all(p > b["prijs"] for p in groot) and b["prijs"] >= 2.5:
        return {**b, "maat_aangenomen": True, "maat_reden": "andere maten apart op de kaart"}
    if index and abs(b["prijs"] - index) / index <= 0.15:
        return {**b, "maat_aangenomen": True, "maat_reden": f"binnen 15% van de Pilsindex (€ {index:.2f})"}
    return None


def landindex(belgie):
    """Mediaan per 25 cl van bevestigde en menukaartprijzen in het hele land."""
    codes = {g["naam"]: g["code"] for g in rest("gemeenten?select=naam,code")}
    rij = rest("kroeg_tijdlijn?select=kroeg_id,gemeente,prijs_cent,volume_cl,status,bron&soort=neq.check&order=op")
    laatst = {r["kroeg_id"]: r["prijs_cent"] * 25 / r["volume_cl"] for r in rij if r["volume_cl"] and (r["status"] == "bevestigd" or r["bron"] == "menukaart")
              and codes.get(r["gemeente"], "").startswith("BE" if belgie else "GM")}
    return statistics.median(laatst.values()) / 100 if len(laatst) >= 5 else None


def stap_kies(stad, map_, belgie):
    d = json.load(open(f"{map_}/deepseek.json"))
    index = index_van(stad) or landindex(belgie)
    kandidaten, tapbieren = [], []
    for kid, v in d.items():
        tb = [b for b in v.get("tapbieren", []) if b.get("tap") is not False and not b.get("actie") and b.get("prijs")]
        if tb:
            br = v.get("_bronnen", [])
            tapbieren.append({"kroeg_id": int(kid), "kroeg": v["naam"], "tapbieren": [{**b, "bron": br[b["doc"] - 1] if isinstance(b.get("doc"), int) and 0 < b["doc"] <= len(br) else None} for b in tb],
                              "datum_aanwijzingen": [a.get("tekst") for a in v.get("datum_aanwijzingen", [])]})
        pils = [b for b in tb if b.get("soort") == "pils"]
        p25 = [b for b in pils if b.get("cl") in (25, 25.0)]
        kies = min(p25, key=lambda b: b["prijs"]) if p25 else None
        if not kies:
            kies = kies_zonder_maat(pils, index, belgie)
        if kies and 2.0 <= kies["prijs"] <= 7.5:
            br = v.get("_bronnen", [])
            kandidaten.append({"kroeg_id": int(kid), "kroeg": v["naam"], **kies, "bron": br[kies["doc"] - 1] if isinstance(kies.get("doc"), int) and 0 < kies["doc"] <= len(br) else None,
                               "datum_aanwijzingen": v.get("datum_aanwijzingen", [])})
    json.dump({"stad": stad, "index": index, "kandidaten": kandidaten}, open(f"{map_}/kandidaten.json", "w"), ensure_ascii=False, indent=1)
    json.dump({"stad": stad, "opgehaald": datetime.date.today().isoformat(), "methode": "eigen websites, gelezen door DeepSeek; niet nagekeken", "kroegen": tapbieren},
              open(f"{map_}/tapbieren.json", "w"), ensure_ascii=False, indent=1)
    print(f"index {index}; {len(kandidaten)} kandidaten; {len(tapbieren)} kroegen met tapbieren")
    for c in sorted(kandidaten, key=lambda c: c["prijs"]):
        print(f"  {c['kroeg_id']} {c['kroeg'][:30]:30} {c['naam'][:24]:24} {c.get('cl')} cl  {c['prijs']:.2f}{'  maat aangenomen' if c.get('maat_aangenomen') else ''}")


def uitsnede(pdf, sleutel, doel, dpi=110, kop=120):
    """Uitsnede rond de regel in een pdf (pdftotext -bbox-layout) en de hele pagina, voor het nakijken."""
    from PIL import Image
    import xml.etree.ElementTree as ET
    x = subprocess.run(["pdftotext", "-bbox-layout", pdf, "-"], capture_output=True, text=True).stdout
    x = re.sub(r"<!DOCTYPE[^>]*>", "", x).replace('xmlns="http://www.w3.org/1999/xhtml"', "")
    x = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", re.sub(r"&(?!amp;|lt;|gt;|quot;|apos;|#)", "&amp;", x))
    woorden = re.escape(sleutel[:25]).replace(r"\ ", r"\s+")
    for pn, page in enumerate(ET.fromstring(x).iter("page"), 1):
        for line in page.iter("line"):
            if re.search(woorden, " ".join(w.text or "" for w in line.iter("word")), re.I):
                x0, y0, x1, y1 = (float(line.get(a)) for a in ("xMin", "yMin", "xMax", "yMax"))
                subprocess.run(["pdftoppm", "-r", str(dpi), "-f", str(pn), "-l", str(pn), "-png", "-singlefile", pdf, f"{doel}/pagina"])
                im = Image.open(f"{doel}/pagina.png").convert("RGB"); s = dpi / 72
                im.crop((max(0, (x0 - 40) * s), max(0, (y0 - kop) * s), min(im.width, (x1 + 300) * s), min(im.height, (y1 + 40) * s))).save(f"{doel}/uitsnede.jpg", quality=90)
                im.thumbnail((1024, 4096)); im.save(f"{doel}/foto.jpg", quality=85); os.remove(f"{doel}/pagina.png")
                return True
    return False


def stap_gevallen(map_):
    k = json.load(open(f"{map_}/kandidaten.json"))
    for c in k["kandidaten"]:
        doel = f"{map_}/gevallen/{c['kroeg_id']}-{re.sub(r'[^a-z0-9]+', '-', c['kroeg'].lower()).strip('-')}"
        os.makedirs(doel, exist_ok=True)
        tekst = ""
        for f in sorted(glob.glob(f"{map_}/sites/{c['kroeg_id']}-*.txt")):
            t = open(f, errors="ignore").read()
            if t.split("\n", 1)[0] == c.get("bron"):
                i = t.find(c["regel"].split("\n")[0][:30]); tekst = t[max(0, i - 800): i + 800] if i >= 0 else ""
                pdf = f[:-4] + ".pdf"
                if os.path.exists(pdf): uitsnede(pdf, c["regel"].split("\n")[0], doel)
                if os.path.exists(f[:-4] + ".jpg"): shutil.copy(f[:-4] + ".jpg", f"{doel}/foto.jpg")
        geval = {"kroeg": c["kroeg"], "kroeg_id": c["kroeg_id"], "bron": c.get("bron"), "regel_op_de_kaart": c["regel"],
                 "gelezen": {"merk": c["naam"], "volume_cl": 25, "prijs": c["prijs"], "tap": c.get("tap")},
                 "datum_aanwijzingen": c.get("datum_aanwijzingen"), "tekst_rond_de_regel": tekst,
                 "lezer": "DeepSeek las de website", "reden": "DAEN-methode: elke prijs wordt nagekeken"}
        if c.get("maat_aangenomen"):
            geval.update(maat_aangenomen=True, index=k["index"], regel_maat="Een pils van het vat zonder maat telt als het gewone glas van 25 cl (vaasje, in België pintje) "
                         f"als er maar een prijs zonder maat bij dat bier staat en: {c.get('maat_reden', 'binnen 15% van de Pilsindex')}.")
        json.dump(geval, open(f"{doel}/geval.json", "w"), ensure_ascii=False, indent=1)
    print(f"{len(k['kandidaten'])} gevallen in {map_}/gevallen; zonder uitsnede: maak een schermafbeelding of laat de controleur de tekst gebruiken")


MERKEN = ["Hertog Jan", "Heineken", "Amstel", "Grolsch", "Brand", "Bavaria", "Jupiler", "Stella Artois", "Primus", "Cristal",
          "Maes", "Bavik", "Swinckels", "Alfa", "Gulpener", "Warsteiner", "Jever", "Birra Moretti", "Estrella Galicia", "Estaminet",
          "Zenne Pils", "Lindeboom", "Budels", "Kordaat", "Palm", "Carlsberg", "Pilsner Urquell", "Weihenstephaner", "Uiltje", "Brouwerij 't IJ"]
DMY = re.compile(r"(?<!\d)(\d{1,2})[-_.](\d{1,2})[-_.](20\d\d)(?!\d)")
YMD = re.compile(r"(?<!\d)(20\d\d)[-_.]?(\d\d)[-_.]?(\d\d)(?!\d)")


def merk_van(naam):
    for m in MERKEN:
        if m.lower().split()[0] in naam.lower() and (len(m.split()) == 1 or m.lower() in naam.lower() or m in ("Stella Artois", "Birra Moretti", "Estrella Galicia")):
            return m
    rest = re.sub(r"\(?\d+[,.]?\d*\s*c?l\)?|\b(vaasje|vaas|pilsener|pilsner|pils|tapbier)\b|\d+[,.]\d\s*%", " ", naam, flags=re.I)
    return " ".join(rest.split()) or "Pils"


def datum_ok(j, m, d):
    try:
        x = datetime.date(int(j), int(m), int(d))
        return x.isoformat() if datetime.date(2015, 1, 1) <= x <= datetime.date.today() else None
    except ValueError:
        return None


def kop(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA, method="HEAD"), timeout=25) as r:
            return r.headers.get("Last-Modified")
    except Exception:
        return None


def datum_van(map_, c):
    """Datum van de kaart zelf, in de volgorde van de DAEN-methode. Geeft (datum, bron) of (None, wat er geprobeerd is)."""
    u = c["bron"]; p = urllib.parse.urlparse(u); basis = f"{p.scheme}://{p.netloc}"
    naam = urllib.parse.unquote(p.path.rsplit("/", 1)[-1])
    for r in (DMY, YMD):  # 1. datum in de bestandsnaam
        for m in r.finditer(naam):
            d = datum_ok(m[3], m[2], m[1]) if r is DMY else datum_ok(m[1], m[2], m[3])
            if d: return d, f"datum in de bestandsnaam {naam}"
    try: data, soort, lm, _ = haal(u, pogingen=1)
    except Exception: return None, "bron niet bereikbaar"
    if data[:3] == b"\xff\xd8\xff" or data[:4] == b"\x89PNG" or data[8:12] == b"WEBP":  # afbeelding: EXIF, dan de uploadmap van WordPress
        try:
            from PIL import Image
            import io
            ex = Image.open(io.BytesIO(data)).getexif()
            m = re.match(r"(\d{4}):(\d\d):(\d\d)", str(ex.get_ifd(0x8769).get(36867) or ex.get(306) or ""))
            if m and datum_ok(*m.groups()): return datum_ok(*m.groups()), "EXIF van de afbeelding"
        except Exception:
            pass
        m = re.search(r"/uploads/(20\d\d)/(\d\d)/", u)
        if m and datum_ok(m[1], m[2], 1): return datum_ok(m[1], m[2], 1), "uploadmap van WordPress"
    if data[:5] == b"%PDF-":  # 2. pdf-datum
        open(f"{map_}/_datum.pdf", "wb").write(data)
        info = subprocess.run(["pdfinfo", f"{map_}/_datum.pdf"], capture_output=True, text=True).stdout
        for veld in ("ModDate", "CreationDate"):
            m = re.search(veld + r":\s+(.+)", info)
            if m:
                try: return datetime.datetime.strptime(" ".join(m[1].split()[:5]), "%a %b %d %H:%M:%S %Y").date().isoformat(), f"pdf {veld}"
                except ValueError: pass
    t = data.decode("utf-8", "replace")
    pid = re.search(r"page-id-(\d+)", t); slug = p.path.strip("/").split("/")[-1]
    for wp in ([f"{basis}/wp-json/wp/v2/pages/{pid[1]}?_fields=modified"] if pid else []) + ([f"{basis}/wp-json/wp/v2/pages?slug={slug}&_fields=modified"] if slug and "." not in slug else []):
        try: j = haal(wp, json_=True, pogingen=1)  # 3. WordPress
        except Exception: continue
        j = j[0] if isinstance(j, list) and j else j
        if isinstance(j, dict) and j.get("modified"): return j["modified"][:10], "WordPress modified"
    m = re.search(r'(?:"dateModified"\s*:\s*"|article:modified_time"\s+content=")(\d{4}-\d\d-\d\d)', t)
    if m: return m[1], "dateModified van de pagina"
    for sm in ("/sitemap.xml", "/sitemap_index.xml"):  # 4. sitemap; overal dezelfde datum is een publicatie van de hele site
        try: x = haal(basis + sm, pogingen=1)[0].decode("utf-8", "replace")
        except Exception: continue
        xs = [x] + [haal(s, pogingen=1)[0].decode("utf-8", "replace") for s in re.findall(r"<loc>([^<]+\.xml)</loc>", x)[:8]]
        paren = [pr for y in xs for pr in re.findall(r"<loc>([^<]+)</loc>\s*<lastmod>([^<]+)</lastmod>", y)]
        overal = len({lm_[:10] for _, lm_ in paren}) == 1
        kaal = lambda x: re.sub(r"/(en|nl|fr|de)(?=/|$)", "", x.rstrip("/").split("//")[-1].replace("www.", ""))
        for loc, lm_ in paren:
            if kaal(loc) == kaal(u):
                if not (overal and lm_[:10] == datetime.date.today().isoformat()):  # overal vandaag: gemaakt bij het opvragen
                    return lm_[:10], "lastmod in de sitemap" + (" (hele site)" if overal else "")
        break
    if lm:  # 5. Last-Modified, alleen als hij bij opnieuw opvragen gelijk blijft
        time.sleep(3)
        if kop(u) == lm:
            d = datetime.datetime.strptime(lm[5:16], "%d %b %Y").date().isoformat()
            return d, "vaste Last-Modified" + (" (vandaag: later nog eens opvragen)" if d == datetime.date.today().isoformat() else "")
    return None, "geen datum gevonden"


def stap_datum(stad, map_):
    gevallen = []
    for g in sorted(glob.glob(f"{map_}/gevallen/*/geval.json")):
        o = g.replace("geval.json", "oordeel.json")
        if not os.path.exists(o): continue
        geval, oordeel = json.load(open(g)), json.load(open(o))
        if not (oordeel.get("is_menukaart") and oordeel.get("prijs_klopt")):
            print(f"  af   {geval['kroeg'][:30]:30} {oordeel.get('toelichting', '')[:80]}"); continue
        geval["datum"], geval["datum_bron"] = datum_van(map_, geval)
        gevallen.append(geval)
    oud = rest(f"kroeg_tijdlijn?select=kroeg_id,prijs_cent,volume_cl,status,bron&gemeente=eq.{urllib.parse.quote(stad)}&soort=neq.check&order=op")
    prijzen = {r["kroeg_id"]: r["prijs_cent"] / 100 * 25 / r["volume_cl"] for r in oud if r["volume_cl"] and (r["status"] == "bevestigd" or r["bron"] == "menukaart")}
    prijzen.update({g["kroeg_id"]: g["gelezen"]["prijs"] for g in gevallen if g["datum"]})
    mediaan = statistics.median(prijzen.values()) if len(prijzen) >= 5 else None
    invoer = []
    for g in gevallen:
        prijs = g["gelezen"]["prijs"]
        if not g["datum"]: fout = g["datum_bron"]
        elif not 2.0 <= prijs <= 7.5: fout = "buiten € 2,00 tot € 7,50"
        elif mediaan and abs(prijs - mediaan) / mediaan > 0.30: fout = f"meer dan 30% van de mediaan (€ {mediaan:.2f})"
        else: fout = None
        print(f"  {'GOED' if not fout else 'af  '} {g['kroeg'][:30]:30} € {prijs:.2f}  {g['datum'] or '':10}  {fout or g['datum_bron']}")
        if fout: continue
        host = urllib.parse.urlparse(g["bron"]).netloc.replace("www.", "")
        if re.search(r"cdn|static|cloudfront|amazonaws|website-files", host): host = g["kroeg"]  # bestand bij een opslagdienst
        omschr = f"Drankkaart {host} ({g['datum_bron'].split(' (')[0]} {g['datum']})" + (", maat aangenomen" if g.get("maat_aangenomen") else "")
        invoer.append({"kroeg_id": g["kroeg_id"], "merk": merk_van(g["gelezen"]["merk"]), "volume_cl": 25, "prijs_cent": round(prijs * 100),
                       "datum": g["datum"], "bron_omschrijving": omschr[:80]})
    json.dump(invoer, open(f"{map_}/import.json", "w"), ensure_ascii=False)
    print(f"mediaan {mediaan}; {len(invoer)} in {map_}/import.json: select public.importeer_menuprijzen('<inhoud>'::jsonb)")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    extra = sys.argv[sys.argv.index("--extra") + 1] if "--extra" in sys.argv else None
    if extra in args: args.remove(extra)
    if not args: print(__doc__); sys.exit(1)
    stad, stappen = args[0], args[1:] or ["kroegen", "crawl", "lees", "kies", "gevallen"]
    gem = rest(f"gemeenten?select=code&naam=eq.{urllib.parse.quote(stad)}")
    if not gem: sys.exit(f"{stad} staat niet in de gemeentelijst")
    belgie = gem[0]["code"].startswith("BE")
    map_ = os.path.join(HIER, "nakijken", f"{datetime.date.today().isoformat()}-{re.sub(r'[^a-z0-9]+', '-', stad.lower())}")
    os.makedirs(map_, exist_ok=True)
    for s in stappen:
        print(f"== {s}")
        {"kroegen": lambda: stap_kroegen(stad, map_, extra), "crawl": lambda: stap_crawl(map_), "lees": lambda: stap_lees(map_),
         "kies": lambda: stap_kies(stad, map_, belgie), "gevallen": lambda: stap_gevallen(map_), "datum": lambda: stap_datum(stad, map_)}[s]()
    print(f"map: {map_}")
