// Stuurt de kroegen naar de database-functie importeer_google_kroegen.
// Vereist de service_role- of secret key: alleen lokaal of als CI-secret gebruiken,
// nooit in de app of in git.

export function naarImport(k) {
  return {
    place_id: k.place_id,
    naam: k.naam,
    soort: k.soort,
    zekerheid: k.zekerheid,
    categorieen: k.categorieen,
    adres: k.adres,
    postcode: k.postcode,
    lat: k.lat,
    lon: k.lon,
    openingstijden: k.openingstijden,
  };
}

export async function stuurNaarSupabase({ url, sleutel, gemeente, kroegen, volledig }) {
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/importeer_google_kroegen`, {
    method: "POST",
    headers: {
      apikey: sleutel,
      Authorization: `Bearer ${sleutel}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_kroegen: kroegen.filter((k) => k.place_id).map(naarImport), p_gemeente: gemeente, p_volledig: volledig }),
  });
  const tekst = await res.text();
  if (!res.ok) throw new Error(`Supabase gaf ${res.status}: ${tekst}`);
  return JSON.parse(tekst);
}
