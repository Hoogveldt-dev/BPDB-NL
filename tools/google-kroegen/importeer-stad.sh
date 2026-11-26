#!/bin/bash
# Kroegen van een gemeente importeren vanuit een cloudsessie: Overpass ophalen (met nieuwe pogingen) en het antwoord
# naar de eenmalige functie sturen. Gebruik: EENMALIG=<sleutel> ./importeer-stad.sh <gemeentecode> [alleen-ophalen]
# Uitleg: supabase/README.md, Kroegen importeren vanuit een sessie.
set -u
c=$1; hier=$(cd "$(dirname "$0")" && pwd); map=$(mktemp -d)
node -e 'import(process.argv[1]).then(m=>process.stdout.write(m.osmQuery({code:process.argv[2]})))' "$hier/../../app/overpass.js" "$c" > "$map/q"
for ronde in 1 2 3 4 5 6; do
  for s in maps.mail.ru/osm/tools/overpass overpass.private.coffee; do
    code=$(curl -s -m 280 -A "Bierkoers kroegimport (https://bierkoers.nl)" --data-urlencode data@"$map/q" "https://$s/api/interpreter" -o "$map/a" -w "%{http_code}")
    # Alleen een volledig antwoord: geen remark en minstens een element met tags (een verouderde kopie geeft alleen de grens)
    if [ "$code" = 200 ] && python3 -I -c 'import json,sys;d=json.load(open(sys.argv[1]));sys.exit(0 if "remark" not in d and any(e.get("tags") for e in d["elements"]) else 1)' "$map/a"; then
      echo "Overpass: $s, $(stat -c%s "$map/a") bytes" >&2
      [ "${2:-}" = alleen-ophalen ] && { cp "$map/a" "$c.json"; echo "$c.json"; exit 0; }
      python3 -I -c 'import json,sys;print(json.dumps({"gemeentecode":sys.argv[2],"elementen":json.load(open(sys.argv[1]))["elements"]}))' "$map/a" "$c" > "$map/b"
      curl -s -m 280 -X POST -H "x-eenmalig: $EENMALIG" -H "Content-Type: application/json" --data @"$map/b" \
        https://yzaootlrhxzyxtvacrot.supabase.co/functions/v1/eenmalig-import -w "\n%{http_code}\n"
      exit 0
    fi
    echo "Overpass: $s $code, opnieuw" >&2; sleep 10
  done
done
echo "Overpass niet bereikbaar voor $c" >&2; exit 1
