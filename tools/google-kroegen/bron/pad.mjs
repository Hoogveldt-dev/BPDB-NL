// Veilig lezen in de geneste arrays die Google Maps teruggeeft.
// Idee en werkwijze van getNthElementAndCast uit gosom/google-maps-scraper
// (MIT, (c) 2023 Georgios Komninos): elke stap mag ontbreken, dan geen fout
// maar undefined. Zo breekt een gewijzigd veld nooit de hele plaats.

export function pad(arr, ...indexen) {
  let a = arr;
  for (const i of indexen) {
    if (!Array.isArray(a) || i >= a.length || a[i] == null) return undefined;
    a = a[i];
  }
  return a;
}

export function tekst(v) {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

export function getal(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function lijst(v) {
  return Array.isArray(v) ? v : [];
}
