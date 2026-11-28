#!/usr/bin/env python3
"""Guinness-prijzen uit de tapbieren die DeepSeek van de websites las (tapbieren.json van drankkaarten.py).

Per kroeg de prijs van een glas Guinness: de prijs bij 50 cl, of zonder maat de hoogste prijs zonder maat (een Guinness
is bijna altijd een pint van 50 cl; een lagere prijs zonder maat ernaast is een halve pint). Een glas van 30 cl of minder
telt niet. Per 50 cl tussen € 5 en € 13, anders valt hij af. DeepSeek kijkt elke prijs na aan de regel van de kaart.
Tap of blik maakt nog niet uit. Datum: de dag dat de kaart is gelezen.

Gebruik: python3 guinness.py <tapbieren.json> [...] [--uit guinness.json]
Importeren: met SUPABASE_SERVICE_ROLE_KEY zelf (kroeg_aanbod, soort guinness, zonder speler: van de menukaart), anders
noemt het script de SQL voor execute_sql. Een kroeg die al een Guinness-prijs heeft, slaat het over.
"""
import json, os, sys, urllib.request

import drankkaarten as dk

OPDRACHT = """Je krijgt een regel van de drankkaart van een kroeg en de prijs die eruit is gelezen voor een glas Guinness van de tap.
Klopt het dat dit de prijs is van een glas Guinness (een pint of 50 cl; staat er geen maat, dan is het het gewone Guinnessglas)?
Niet goed: een halve pint, een kan of pitcher, een actieprijs, of een prijs van een ander bier.
Antwoord alleen met JSON: {"klopt": true, "toelichting": "kort"}"""


def kies(bieren):
    g = [b for b in bieren if "guinness" in (b.get("naam") or "").lower() and b.get("prijs") and b.get("tap") is not False and not b.get("actie")]
    vijftig = [b for b in g if b.get("cl") and 40 <= b["cl"] <= 60]
    if vijftig: return min(vijftig, key=lambda b: abs(b["cl"] - 50))
    zonder = [b for b in g if not b.get("cl")]
    if zonder: return {**max(zonder, key=lambda b: b["prijs"]), "cl": 50, "maat_aangenomen": True}
    return None


def nakijken(kroeg, b):
    tekst = f"Kroeg: {kroeg}\nRegel: {b.get('regel')}\nGelezen: Guinness {b['cl']} cl voor € {b['prijs']:.2f}"
    body = {"model": dk.MODEL, "temperature": 0, "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": OPDRACHT}, {"role": "user", "content": tekst}]}
    req = urllib.request.Request(f"{dk.MODEL_URL}/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {os.environ.get('DEEPSEEK_API_KEY', 'via-proxy')}"})
    d = json.load(urllib.request.urlopen(req, timeout=120))
    return json.loads(d["choices"][0]["message"]["content"])


def rijen(bestanden):
    uit = {}
    for f in bestanden:
        d = json.load(open(f))
        for k in d["kroegen"]:
            b = kies(k["tapbieren"])
            if not b or not k.get("kroeg_id") or k["kroeg_id"] in uit: continue
            per50 = b["prijs"] * 50 / b["cl"]
            if not 5 <= per50 <= 13:
                print(f"  af  {k['kroeg'][:30]:30} € {b['prijs']:.2f} voor {b['cl']} cl valt buiten € 5 tot € 13 per 50 cl"); continue
            o = nakijken(k["kroeg"], b)
            print(f"  {'goed' if o.get('klopt') else 'af  '} {k['kroeg'][:30]:30} € {b['prijs']:.2f} {b['cl']} cl  {o.get('toelichting', '')[:70]}")
            if o.get("klopt"):
                uit[k["kroeg_id"]] = {"kroeg_id": k["kroeg_id"], "merk": "Guinness", "volume_cl": int(b["cl"]),
                                      "prijs_cent": round(b["prijs"] * 100), "op": d.get("opgehaald")}
    return list(uit.values())


def importeer(r):
    if not r: return print("geen Guinness-prijzen")
    sleutel = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not sleutel:
        return print(f"{len(r)} Guinness-prijzen; importeer met execute_sql:\n" + sql(r))
    h = {"apikey": sleutel, "Authorization": f"Bearer {sleutel}", "Content-Type": "application/json"}
    ids = ",".join(str(x["kroeg_id"]) for x in r)
    al = {x["kroeg_id"] for x in dk.haal(f"{dk.SUPABASE}/kroeg_aanbod?select=kroeg_id&soort=eq.guinness&status=eq.actief&kroeg_id=in.({ids})", json_=True, headers=h)}
    nieuw = [{**x, "soort": "guinness"} for x in r if x["kroeg_id"] not in al]
    if nieuw:
        req = urllib.request.Request(f"{dk.SUPABASE}/kroeg_aanbod", data=json.dumps(nieuw).encode(), headers=h, method="POST")
        urllib.request.urlopen(req, timeout=60).read()
    print(f"{len(nieuw)} Guinness-prijzen toegevoegd, {len(r) - len(nieuw)} overgeslagen")


def sql(r):
    return ("insert into kroeg_aanbod (kroeg_id, soort, merk, volume_cl, prijs_cent, op) select (x->>'kroeg_id')::bigint, 'guinness', "
            "x->>'merk', (x->>'volume_cl')::smallint, (x->>'prijs_cent')::int, (x->>'op')::timestamptz from jsonb_array_elements($j$"
            + json.dumps(r, ensure_ascii=False) + "$j$::jsonb) x join kroegen k on k.id = (x->>'kroeg_id')::bigint and k.open "
            "where not exists (select 1 from kroeg_aanbod a where a.kroeg_id = k.id and a.soort = 'guinness' and a.status = 'actief');")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    uitpad = sys.argv[sys.argv.index("--uit") + 1] if "--uit" in sys.argv else None
    if uitpad in args: args.remove(uitpad)
    if not args: print(__doc__); sys.exit(1)
    r = rijen(args)
    if uitpad: json.dump(r, open(uitpad, "w"), ensure_ascii=False)
    importeer(r)
