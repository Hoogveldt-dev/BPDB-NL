// Openbare instellingen van de app. De publishable key mag in de browser staan:
// de toegang wordt geregeld door de RLS-regels in de database.
// Zet hier NOOIT de service_role- of secret-key of het databasewachtwoord.
export const SUPABASE_URL = "https://yzaootlrhxzyxtvacrot.supabase.co";
export const SUPABASE_KEY = "sb_publishable_Nc0p9wvcJJWZN6rRYiBOyA_2QW3IPKs";

export const STAD = {
  naam: "Nijmegen",
  gemeentecode: "GM0268",
  centrum: [5.8638, 51.8426],
  zoom: 13.2,
};

export const KAARTSTIJL = {
  licht: "https://tiles.openfreemap.org/styles/liberty",
  donker: "https://tiles.openfreemap.org/styles/dark",
};
