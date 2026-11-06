-- Betere koppeling van Google-plaatsen aan OSM-kroegen.
--
-- Een proef met de echte kroegen van Nijmegen liet zien dat "binnen 15 m altijd
-- koppelen" misgaat in drukke straten (Grote Markt, Molenstraat): daar liggen
-- kroegen op een paar meter van elkaar. Nu:
--   - de naamkern laat ook lidwoorden (de, het, 't, the, le, la) en de plaatsnaam weg,
--     en valt terug op de hele naam als er niets overblijft ("Le Café");
--   - koppelen vraagt altijd om een gelijkende naam: ten minste 0,35 binnen 75 m,
--     of ten minste 0,15 binnen 25 m (voor "Café Jos" en "Café Jos Meesterschenkerij");
--   - alle kandidaat-paren worden in een keer verdeeld, beste naam eerst, zodat een
--     kroeg niet wordt "weggekaapt" door een buurman die eerder in de lijst stond.

create or replace function private.kroegnaam_kern(p_naam text, p_plaats text default null)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  -- Blijft er niets over ("Le Café", "Bar"), dan de hele naam.
  select coalesce(
    nullif(btrim(regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(p_naam, '')),
          '\m(eet|bier|brouwerij|feest|studenten|bruin )?(caf[eé]|bar|pub)\M', ' ', 'g'),
        '\m(de|het|the|le|la|''t)\M' || coalesce('|\m' || nullif(lower(p_plaats), '') || '\M', ''), ' ', 'g'),
      '[^[:alnum:]]+', ' ', 'g')), ''),
    btrim(regexp_replace(lower(coalesce(p_naam, '')), '[^[:alnum:]]+', ' ', 'g')));
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
  p record;
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

  create temp table pg_temp.g_invoer on commit drop as
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
           extensions.st_setsrid(extensions.st_makepoint((x ->> 'lon')::float8, (x ->> 'lat')::float8), 4326)::extensions.geography as locatie,
           null::bigint as kroeg_id,
           false as was_gekoppeld
    from jsonb_array_elements(p_kroegen) x
    where coalesce(x ->> 'place_id', '') <> ''
      and coalesce(x ->> 'naam', '') <> ''
      and x ->> 'lat' is not null and x ->> 'lon' is not null
      and x ->> 'zekerheid' in ('hoog', 'middel');

  -- 1. Al gekoppeld?
  update pg_temp.g_invoer g set kroeg_id = k.id, was_gekoppeld = true
  from public.kroegen k
  where k.google_place_id = g.place_id;

  -- 2. Kandidaat-paren met nog niet gekoppelde kroegen, beste naam eerst verdelen.
  for p in
    select g.place_id, k.id as kroeg_id
    from pg_temp.g_invoer g
    join public.kroegen k
      on k.gemeente = p_gemeente
     and k.google_place_id is null
     and extensions.st_dwithin(k.locatie, g.locatie, 75)
    cross join lateral (
      select extensions.st_distance(k.locatie, g.locatie) as afstand,
             extensions.similarity(private.kroegnaam_kern(k.naam, p_gemeente), private.kroegnaam_kern(g.naam, p_gemeente)) as gelijk
    ) m
    where g.kroeg_id is null
      and (m.gelijk >= 0.35 or (m.gelijk >= 0.15 and m.afstand <= 25))
    order by m.gelijk desc, m.afstand
  loop
    update pg_temp.g_invoer g set kroeg_id = p.kroeg_id
    where g.place_id = p.place_id
      and g.kroeg_id is null
      and not exists (select 1 from pg_temp.g_invoer x where x.kroeg_id = p.kroeg_id);
  end loop;

  -- 3. Bijwerken, of nieuw toevoegen.
  for r in select * from pg_temp.g_invoer loop
    if r.was_gekoppeld then
      n_bijgewerkt := n_bijgewerkt + 1;
      doel := r.kroeg_id;
    elsif r.kroeg_id is not null then
      n_gekoppeld := n_gekoppeld + 1;
      doel := r.kroeg_id;
    else
      insert into public.kroegen (naam, soort, adres, gemeente, locatie)
      values (r.naam, r.soort, r.adres, p_gemeente, r.locatie)
      returning id into doel;
      n_nieuw := n_nieuw + 1;
    end if;

    update public.kroegen k
    -- Een veld dat in deze run ontbreekt, wist de bekende waarde niet.
    set google_place_id = r.place_id,
        google_cid = coalesce(r.cid, k.google_cid),
        google_categorieen = coalesce(nullif(r.categorieen, '{}'), k.google_categorieen),
        google_zekerheid = r.zekerheid,
        google_beoordeling = coalesce(r.beoordeling, k.google_beoordeling),
        google_aantal_reviews = coalesce(r.aantal_reviews, k.google_aantal_reviews),
        telefoon = coalesce(r.telefoon, k.telefoon),
        website = coalesce(r.website, k.website),
        openingstijden = coalesce(case when jsonb_typeof(r.openingstijden) = 'object' then r.openingstijden end, k.openingstijden),
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
      and k.google_place_id not in (select place_id from pg_temp.g_invoer);
    get diagnostics n_gemist = row_count;

    update public.kroegen k
    set open = false
    where k.gemeente = p_gemeente
      and k.osm_id is null
      and k.open
      and k.google_gemist >= 2;
    get diagnostics n_gesloten = row_count;
  end if;

  drop table pg_temp.g_invoer;
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

drop function if exists private.kroegnaam_kern(text);
revoke all on function private.kroegnaam_kern(text, text) from public, anon, authenticated;
revoke all on function private.importeer_google_kroegen(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function private.kroegnaam_kern(text, text) to service_role;
