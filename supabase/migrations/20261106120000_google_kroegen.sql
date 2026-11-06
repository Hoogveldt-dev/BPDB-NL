-- Google Maps als tweede bron naast OpenStreetMap.
--
-- De tool tools/google-kroegen haalt kroegen uit Google Maps en roept
-- public.importeer_google_kroegen aan met de service_role-key. Per Google-plaats:
--   1. al gekoppeld (google_place_id)      -> Google-gegevens bijwerken;
--   2. anders een OSM-kroeg dichtbij met een gelijkende naam -> koppelen;
--   3. anders                              -> nieuwe kroeg (osm_id leeg).
-- Naam en locatie van OSM-kroegen blijven leidend; Google vult aan.
--
-- Google laat definitief gesloten zaken weg uit de zoekresultaten. Daarom telt
-- elke volledige run (p_volledig) hoe vaak een gekoppelde kroeg niet meer is
-- gezien. Een kroeg die alleen uit Google komt, gaat na 2 gemiste volledige
-- runs dicht. Over OSM-kroegen beslist de OSM-import.

create extension if not exists pg_trgm with schema extensions;

alter table public.kroegen
  add column google_place_id text unique,
  add column google_cid text,
  add column google_categorieen text[],
  add column google_zekerheid text check (google_zekerheid in ('hoog', 'middel')),
  add column google_beoordeling numeric(2, 1) check (google_beoordeling between 0 and 5),
  add column google_aantal_reviews integer check (google_aantal_reviews >= 0),
  add column telefoon text,
  add column website text,
  add column openingstijden jsonb,
  add column google_laatst_gezien timestamptz,
  add column google_gemist smallint not null default 0;

comment on column public.kroegen.google_place_id is 'Google Place ID (ChIJ...); gezet door tools/google-kroegen.';
comment on column public.kroegen.google_gemist is 'Aantal volledige Google-runs op rij waarin deze kroeg niet voorkwam.';

-- Kern van een kroegnaam om namen uit OSM en Google te vergelijken:
-- "Café De Kroeg🍺" en "De Kroeg" worden allebei "de kroeg".
create or replace function private.kroegnaam_kern(p_naam text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(
    regexp_replace(lower(coalesce(p_naam, '')),
      '\m(grand )?(eet|bier|brouwerij|feest|studenten|bruin )?(caf[eé]|bar|pub|kroeg)\M', ' ', 'g'),
    '[^[:alnum:]]+', ' ', 'g'));
$$;

create or replace function private.importeer_google_kroegen(
  p_kroegen jsonb,
  p_gemeente text,
  p_volledig boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  doel bigint;
  n_bijgewerkt integer := 0;
  n_gekoppeld integer := 0;
  n_nieuw integer := 0;
  n_gemist integer := 0;
  n_gesloten integer := 0;
begin
  if jsonb_typeof(p_kroegen) <> 'array' then
    raise exception 'p_kroegen moet een array zijn';
  end if;

  for r in
    select x ->> 'place_id' as place_id,
           x ->> 'cid' as cid,
           x ->> 'naam' as naam,
           x ->> 'soort' as soort,
           x ->> 'zekerheid' as zekerheid,
           coalesce(array(select jsonb_array_elements_text(x -> 'categorieen')), '{}') as categorieen,
           nullif(concat_ws(', ', x ->> 'adres', x ->> 'postcode'), '') as adres,
           (x ->> 'beoordeling')::numeric as beoordeling,
           (x ->> 'aantal_reviews')::integer as aantal_reviews,
           x ->> 'telefoon' as telefoon,
           x ->> 'website' as website,
           x -> 'openingstijden' as openingstijden,
           extensions.st_setsrid(extensions.st_makepoint((x ->> 'lon')::float8, (x ->> 'lat')::float8), 4326)::extensions.geography as locatie
    from jsonb_array_elements(p_kroegen) x
    where coalesce(x ->> 'place_id', '') <> ''
      and coalesce(x ->> 'naam', '') <> ''
      and x ->> 'lat' is not null and x ->> 'lon' is not null
      and x ->> 'zekerheid' in ('hoog', 'middel')
  loop
    -- 1. Al gekoppeld?
    select k.id into doel from public.kroegen k where k.google_place_id = r.place_id;

    if found then
      n_bijgewerkt := n_bijgewerkt + 1;
    else
      -- 2. Een nog niet gekoppelde kroeg dichtbij: binnen 15 m altijd, tot 75 m bij een gelijkende naam.
      select k.id into doel
      from public.kroegen k
      cross join lateral (
        select extensions.st_distance(k.locatie, r.locatie) as afstand,
               extensions.similarity(private.kroegnaam_kern(k.naam), private.kroegnaam_kern(r.naam)) as gelijk
      ) m
      where k.gemeente = p_gemeente
        and k.google_place_id is null
        and extensions.st_dwithin(k.locatie, r.locatie, 75)
        and (m.afstand <= 15 or m.gelijk >= 0.4)
      order by m.gelijk desc, m.afstand
      limit 1;

      if found then
        n_gekoppeld := n_gekoppeld + 1;
      else
        -- 3. Nieuw.
        insert into public.kroegen (naam, soort, adres, gemeente, locatie)
        values (r.naam, r.soort, r.adres, p_gemeente, r.locatie)
        returning id into doel;
        n_nieuw := n_nieuw + 1;
      end if;
    end if;

    update public.kroegen k
    set google_place_id = r.place_id,
        google_cid = r.cid,
        google_categorieen = r.categorieen,
        google_zekerheid = r.zekerheid,
        google_beoordeling = r.beoordeling,
        google_aantal_reviews = r.aantal_reviews,
        telefoon = r.telefoon,
        website = r.website,
        openingstijden = case when jsonb_typeof(r.openingstijden) = 'object' then r.openingstijden end,
        adres = coalesce(k.adres, r.adres),
        google_laatst_gezien = now(),
        google_gemist = 0,
        -- Alleen-Google-kroegen volgen Google; OSM-kroegen volgen de OSM-import.
        naam = case when k.osm_id is null then r.naam else k.naam end,
        locatie = case when k.osm_id is null then r.locatie else k.locatie end,
        open = case when k.osm_id is null then true else k.open end
    where k.id = doel;
  end loop;

  if p_volledig then
    update public.kroegen k
    set google_gemist = least(k.google_gemist + 1, 100)
    where k.gemeente = p_gemeente
      and k.google_place_id is not null
      and k.google_place_id not in (
        select x ->> 'place_id' from jsonb_array_elements(p_kroegen) x where x ->> 'place_id' is not null
      );
    get diagnostics n_gemist = row_count;

    update public.kroegen k
    set open = false
    where k.gemeente = p_gemeente
      and k.osm_id is null
      and k.open
      and k.google_gemist >= 2;
    get diagnostics n_gesloten = row_count;
  end if;

  perform private.koppel_wijken();

  return jsonb_build_object(
    'bijgewerkt', n_bijgewerkt,
    'gekoppeld_aan_osm', n_gekoppeld,
    'nieuw', n_nieuw,
    'niet_gezien', n_gemist,
    'gesloten', n_gesloten
  );
end;
$$;

create or replace function public.importeer_google_kroegen(
  p_kroegen jsonb,
  p_gemeente text,
  p_volledig boolean default false
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.importeer_google_kroegen(p_kroegen, p_gemeente, p_volledig);
$$;

revoke all on function public.importeer_google_kroegen(jsonb, text, boolean) from public, anon, authenticated;
revoke all on function private.importeer_google_kroegen(jsonb, text, boolean) from public, anon, authenticated;
revoke all on function private.kroegnaam_kern(text) from public, anon, authenticated;
grant execute on function public.importeer_google_kroegen(jsonb, text, boolean) to service_role;
grant execute on function private.importeer_google_kroegen(jsonb, text, boolean) to service_role;
grant execute on function private.kroegnaam_kern(text) to service_role;
