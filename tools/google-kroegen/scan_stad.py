#!/usr/bin/env python3
"""Prijsscan voor een stad, de vaste laatste stap na het inladen van kroegen (OSM-import of kroegen uit Google Maps).

Stappen, elk met DeepSeek als lezer en controleur:
  1. websites   drankkaarten.py <stad> (restaurantfilter, crawlen, lezen, kandidaten), deepseek-controleur.mjs, stap datum
  2. foto's     menufotos.mjs --extern voor de kroegen met een Google-koppeling die daarna nog geen prijs hebben,
                in brokken van 15 (een afgebroken run gaat verder waar hij was), en deepseek-controleur.mjs
Is het DeepSeek-tegoed op, dan slaat het script de rest over met een melding en eindigt het zonder fout: de kroegen
zelf staan dan al in de database en blijven staan. Een CAPTCHA van Google stopt de fotostap.

Resultaat: nakijken/<datum>-<stad>/import.json (websites) en import-fotos.json (foto's), voor importeer_menuprijzen.
Met SUPABASE_SERVICE_ROLE_KEY importeert het script ze zelf; zonder gaat dat met execute_sql (zie docs/menukaartprijzen.md).
Een prijs die al in de app staat, slaat importeer_menuprijzen over, dus opnieuw draaien kan geen kwaad.

Gebruik: python3 scan_stad.py <stad> [--zonder-fotos]
"""
import datetime, glob, json, os, re, subprocess, sys, urllib.error, urllib.parse, urllib.request

import drankkaarten as dk

HIER = os.path.dirname(os.path.abspath(__file__))
NODE = {**os.environ, "NODE_USE_ENV_PROXY": "1", "NODE_NO_WARNINGS": "1"}
BROK = 15


def tegoed():
    """True als DeepSeek nog antwoordt; False bij 402 (tegoed op). Een piepklein verzoek, want het saldo loopt achter."""
    body = {"model": dk.MODEL, "max_tokens": 1, "messages": [{"role": "user", "content": "ok"}]}
    req = urllib.request.Request(f"{dk.MODEL_URL}/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {os.environ.get('DEEPSEEK_API_KEY', 'via-proxy')}"})
    try:
        urllib.request.urlopen(req, timeout=60).read()
        return True
    except urllib.error.HTTPError as e:
        if e.code == 402: return False
        raise


def stop_zonder_tegoed(waar):
    print(f"DeepSeek-tegoed is op: {waar} overgeslagen. De kroegen staan er wel; draai dit script opnieuw na het opwaarderen.")
    sys.exit(0)


def controleer(map_):
    if glob.glob(f"{map_}/*/geval.json"):
        subprocess.run(["node", "deepseek-controleur.mjs", map_], cwd=HIER, env=NODE, check=False)


def importeer(pad):
    rijen = json.load(open(pad))
    sleutel = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not rijen: return print(f"  {pad}: geen prijzen")
    if not sleutel:
        return print(f"  {len(rijen)} prijzen in {pad}: select public.importeer_menuprijzen('<inhoud>'::jsonb)")
    req = urllib.request.Request(f"{dk.SUPABASE}/rpc/importeer_menuprijzen", data=json.dumps({"p_prijzen": rijen}).encode(),
                                 headers={"Content-Type": "application/json", "apikey": sleutel, "Authorization": f"Bearer {sleutel}"})
    print(f"  {pad}: {urllib.request.urlopen(req, timeout=60).read().decode()}")


def fotos(stad, map_):
    """Foto's in Google Maps voor kroegen met een Google-koppeling zonder prijs, ook niet uit de stap websites."""
    q = urllib.parse.quote(stad)
    k = dk.rest(f"kroegen?select=id,naam,google_place_id&gemeente=eq.{q}&open=is.true&google_place_id=not.is.null&huidig_prijs_cent=is.null")
    al = {g["kroeg_id"] for i in range(0, len(k), 100) for g in
          dk.rest("gebeurtenissen?select=kroeg_id&bron=eq.menukaart&kroeg_id=in.(" + ",".join(str(x["id"]) for x in k[i:i + 100]) + ")")}
    al |= {r["kroeg_id"] for r in json.load(open(f"{map_}/import.json"))} if os.path.exists(f"{map_}/import.json") else set()
    lijst = [{"naam": x["naam"], "place_id": x["google_place_id"]} for x in k if x["id"] not in al]
    print(f"{len(lijst)} kroegen voor de foto's in Google Maps")
    fmap = f"{map_}/fotos"
    os.makedirs(fmap, exist_ok=True)
    for n in range(0, len(lijst), BROK):
        brok, uit = f"{fmap}/brok-{n // BROK:02d}.json", f"{fmap}/uit-{n // BROK:02d}.json"
        if os.path.exists(uit): continue
        if not tegoed(): stop_zonder_tegoed(f"foto's vanaf brok {n // BROK}")
        json.dump(lijst[n:n + BROK], open(brok, "w"), ensure_ascii=False)
        with open(f"{fmap}/log.txt", "a") as log:
            subprocess.run(["node", "menufotos.mjs", "--kroegen", brok, "--extern", "--sinds", (datetime.date.today() - datetime.timedelta(days=760)).isoformat(),
                            "--max-fotos", "150", "--uit", uit, "--nakijken", f"{fmap}/nakijken"], cwd=HIER, env=NODE, stdout=log, stderr=log, check=False)
        if re.search(r"CAPTCHA|Gestopt", open(f"{fmap}/log.txt").read()):
            print("Google vraagt om een CAPTCHA: de fotostap stopt hier (nooit oplossen of omzeilen)."); break
    for d in sorted(glob.glob(f"{fmap}/nakijken/*/")): controleer(d.rstrip("/"))
    # Alle prijzen uit de brokken; een afgekeurde valt af, een goedgekeurde twijfel (buiten 30% van de mediaan) komt erbij
    rijen = {p["google_place_id"]: p for f in glob.glob(f"{fmap}/uit-*.json") for p in json.load(open(f))["prijzen"]}
    for g in glob.glob(f"{fmap}/nakijken/*/*/geval.json"):
        o = g.replace("geval.json", "oordeel.json")
        if not os.path.exists(o): continue
        geval, oordeel = json.load(open(g)), json.load(open(o))
        if not oordeel.get("prijs_klopt"): rijen.pop(geval["place_id"], None)
        elif geval["soort"] == "twijfel" and geval.get("rij"): rijen[geval["place_id"]] = geval["rij"]
    for r in rijen.values():
        merk = (r.get("merk") or "").strip(" -|·,") or "Pils"
        r["merk"], r["bron_omschrijving"] = merk.title() if merk.isupper() else merk, r["bron_omschrijving"][:78]
    json.dump(list(rijen.values()), open(f"{map_}/import-fotos.json", "w"), ensure_ascii=False)
    importeer(f"{map_}/import-fotos.json")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args: print(__doc__); sys.exit(1)
    stad = args[0]
    map_ = os.path.join(HIER, "nakijken", f"{datetime.date.today().isoformat()}-{re.sub(r'[^a-z0-9]+', '-', stad.lower())}")
    if not tegoed(): stop_zonder_tegoed("de hele prijsscan")
    if not os.path.exists(f"{map_}/import.json"):
        subprocess.run([sys.executable, "drankkaarten.py", stad], cwd=HIER, check=True)
        if not tegoed(): stop_zonder_tegoed("nakijken en de foto's")
        controleer(f"{map_}/gevallen")
        subprocess.run([sys.executable, "drankkaarten.py", stad, "datum"], cwd=HIER, check=True)
    importeer(f"{map_}/import.json")
    if "--zonder-fotos" not in sys.argv:
        fotos(stad, map_)
    print(f"map: {map_}")
