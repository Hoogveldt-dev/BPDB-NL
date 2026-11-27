#!/usr/bin/env python3
"""Restaurants zonder kroegkenmerken uit de dataset halen, met DeepSeek als lezer van de menukaart.

Een restaurant hoort in Bierkoers als het ook als café of kroeg werkt. Per restaurant (soort 'restaurant', open,
nog zonder oordeel) leest DeepSeek de website en geeft een oordeel:
  kroeg       blijft: losse drankkaart of borrelkaart, borrelhapjes, bar of tap, of de keuken sluit eerder dan de zaak
  twijfel     blijft, met een markering om na te lopen (ook als er geen website of kaart te vinden is)
  restaurant  gaat eruit: een kaart van gangen of gerechten met drank als bijzaak. De kroeg wordt gesloten,
              de geschiedenis blijft.

Gebruik: python3 restaurantfilter.py <stad> [--opnieuw] [--schrijf]
  --opnieuw  ook restaurants die al een oordeel hebben
  --schrijf  zet de oordelen in de database (public.zet_restaurantoordelen, service_role-sleutel in
             SUPABASE_SERVICE_ROLE_KEY); zonder de sleutel staat het resultaat in nakijken/<datum>-<stad>-restaurants/
             oordelen.json en wordt het met die functie ingevoerd.
drankkaarten.py doet dit als eerste stap, zodat een nieuwe scan restaurants meteen sluit.
Vanuit een cloudsessie voegt de proxy de DeepSeek-sleutel toe; zet anders DEEPSEEK_API_KEY.
"""
import concurrent.futures as cf, datetime, glob, json, os, re, sys, urllib.parse, urllib.request

import drankkaarten as d

OPDRACHT = """Je beoordeelt of een zaak die in OpenStreetMap als restaurant staat, ook als café of kroeg werkt. Bierkoers is een kaart met bierprijzen per kroeg: een zaak hoort erin als je er ook gewoon een biertje kunt drinken zonder te dineren.
Je krijgt de naam, soms de openingstijden en de teksten van de website (pagina's en kaarten), elk met een nummer [D1], [D2], ...
Oordeel:
- "kroeg": er is een losse drankkaart, borrelkaart of bierkaart, of er staan borrelhapjes en bar of tapbier prominent op de site, of de zaak noemt zich café, eetcafé, bar, pub, proeflokaal of brouwerij, of de keuken sluit eerder dan de zaak of opent pas later (de zaak is daarbuiten een café).
- "restaurant": de kaart is vooral gangen, een menu of gerechten (voorgerecht, hoofdgerecht, nagerecht, proeverij, à la carte), reserveren staat centraal, en drank is bijzaak (alleen een wijnkaart of dranken bij het eten).
- "twijfel": de teksten laten het niet duidelijk zien, of er zijn tekenen van allebei.
Kies "kroeg" of "restaurant" alleen met een duidelijk teken in de tekst; anders "twijfel". Verzin niets.
Antwoord alleen met JSON: {"oordeel": "kroeg|restaurant|twijfel", "reden": "een korte zin in het Nederlands met het teken uit de tekst, hoogstens 140 tekens"}"""


CAFENAAM = re.compile(r"caf[eé]|\bbar\b|\bpub\b|kroeg|proeflokaal|\btap\b", re.I)


def kies_kroegen(stad, opnieuw):
    q = f"kroegen?select=id,naam,osm_id,adres,google_place_id,openingstijden&gemeente=eq.{urllib.parse.quote(stad)}&soort=eq.restaurant&open=is.true&order=id"
    if not opnieuw: q += "&restaurant_oordeel=is.null"
    return d.rest(q)


def beoordeel(x, map_, tags):
    """Een oordeel voor een restaurant: tekst van zijn site naar DeepSeek, of twijfel zonder site."""
    bestanden = sorted(glob.glob(f"{map_}/sites/{x['id']}-*.txt"))
    docs = [open(f, errors="ignore").read() for f in bestanden]
    docs = [t for t in docs if "[afbeelding" not in t[:400]]  # alleen tekst, geen kaartfoto's: dat houdt het goedkoop
    if not docs:
        return {"kroeg_id": x["id"], "oordeel": "twijfel", "reden": "Geen website of kaart gevonden", "tokens": [0, 0]}
    uren = tags.get("opening_hours") or (json.dumps(x["openingstijden"], ensure_ascii=False) if x.get("openingstijden") else None)
    inhoud = f"Zaak: {x['naam']}" + (f"\nKeuken (OSM): {tags['cuisine']}" if tags.get("cuisine") else "") + (f"\nOpeningstijden: {uren}" if uren else "")
    ruimte = 24000
    for i, t in enumerate(docs[:8]):
        stuk = f"\n\n[D{i + 1}] {t[:6000]}"[:ruimte]; ruimte -= len(stuk); inhoud += stuk
        if ruimte <= 0: break
    body = {"model": d.MODEL, "temperature": 0, "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": OPDRACHT}, {"role": "user", "content": inhoud}]}
    req = urllib.request.Request(f"{d.MODEL_URL}/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {os.environ.get('DEEPSEEK_API_KEY', 'via-proxy')}"})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=300))
        uit = json.loads(r["choices"][0]["message"]["content"])
        oordeel = uit.get("oordeel") if uit.get("oordeel") in ("kroeg", "restaurant", "twijfel") else "twijfel"
        # Een naam met café, bar, pub of kroeg is nooit zomaar een restaurant: dan twijfel, om na te lopen
        if oordeel == "restaurant" and CAFENAAM.search(x["naam"]): oordeel = "twijfel"
        return {"kroeg_id": x["id"], "oordeel": oordeel, "reden": str(uit.get("reden", ""))[:300],
                "tokens": [r["usage"].get("prompt_tokens", 0), r["usage"].get("completion_tokens", 0)]}
    except Exception as e:
        # Tegoed op of een storing: geen oordeel (dan blijft de zaak ongemoeid en komt hij de volgende keer weer aan bod)
        return {"kroeg_id": x["id"], "fout": str(e)[:200]}


def draai(stad, opnieuw=False, schrijf=False):
    map_ = os.path.join(d.HIER, "nakijken", f"{datetime.date.today().isoformat()}-{re.sub(r'[^a-z0-9]+', '-', stad.lower())}-restaurants")
    os.makedirs(map_, exist_ok=True)
    k = kies_kroegen(stad, opnieuw)
    if not k:
        print("geen restaurants zonder oordeel"); return
    tags = d.osm_tags(k)
    for x in k:
        t = tags.get(x["osm_id"] or "", {})
        x["website"] = t.get("website") or t.get("contact:website") or t.get("url") or t.get("website:menu")
        if x["website"] and d.GEEN_SITE.search(x["website"]): x["website"] = None
    print(f"{len(k)} restaurants, {sum(1 for x in k if x['website'])} met een website")
    os.makedirs(f"{map_}/sites", exist_ok=True)
    with cf.ThreadPoolExecutor(8) as ex:
        list(ex.map(lambda x: d.crawl_een(x, map_) if x["website"] else None, k))
    with cf.ThreadPoolExecutor(6) as ex:
        uit = list(ex.map(lambda x: beoordeel(x, map_, tags.get(x["osm_id"] or "", {})), k))
    naam = {x["id"]: x["naam"] for x in k}
    goed = [o for o in uit if "oordeel" in o]
    fouten = len(uit) - len(goed)
    for o in goed: o["naam"] = naam[o["kroeg_id"]]
    json.dump(goed, open(f"{map_}/oordelen.json", "w"), ensure_ascii=False, indent=1)
    tel = {s: sum(1 for o in goed if o["oordeel"] == s) for s in ("kroeg", "twijfel", "restaurant")}
    tok = [sum(o["tokens"][i] for o in goed) for i in (0, 1)]
    print(f"kroeg {tel['kroeg']}, twijfel {tel['twijfel']}, restaurant {tel['restaurant']}; {fouten} fouten (geen tegoed of storing); tokens in/uit {tok[0]}/{tok[1]}")
    print(f"oordelen: {map_}/oordelen.json")
    if schrijf or os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        sleutel = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not sleutel: sys.exit("Zet SUPABASE_SERVICE_ROLE_KEY om te schrijven")
        req = urllib.request.Request(f"{d.SUPABASE}/rpc/zet_restaurantoordelen", method="POST",
                                     data=json.dumps({"p_oordelen": [{k_: o[k_] for k_ in ("kroeg_id", "oordeel", "reden")} for o in goed]}).encode(),
                                     headers={"apikey": sleutel, "Authorization": f"Bearer {sleutel}", "Content-Type": "application/json"})
        print("database:", urllib.request.urlopen(req, timeout=120).read().decode())
    else:
        print("Niet in de database gezet: voer oordelen.json in met select public.zet_restaurantoordelen('<inhoud>'::jsonb)")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args: print(__doc__); sys.exit(1)
    draai(args[0], "--opnieuw" in sys.argv, "--schrijf" in sys.argv)
