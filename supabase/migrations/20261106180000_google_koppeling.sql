-- Google-kroegen: betere koppeling aan OSM, minder Google-gegevens, en spelers gaan voor.
--
-- 1. Minder opslaan. BPDB bewaart alleen wat het spel gebruikt: Place ID, categorieën
--    en openingstijden. Beoordelingen en reviews passen niet bij het spel (het gaat om
--    de prijs), telefoon en website zijn niet nodig.
-- 2. Spelers gaan voor. Openingstijden die spelers hebben aangepast, en een kroeg die
--    spelers definitief gesloten hebben verklaard, worden niet door een Google-run
--    overschreven (zie 20261106190000_kroeg_meldingen).
-- 3. Betere koppeling. Een proef met de echte kroegen van Nijmegen liet zien dat "binnen
--    15 m altijd koppelen" misgaat in drukke straten (Grote Markt, Molenstraat): daar
--    liggen kroegen op een paar meter van elkaar. Nu:
--    - de naamkern laat ook lidwoorden (de, het, 't, the, le, la) en de plaatsnaam weg,
--      en valt terug op de hele naam als er niets overblijft ("Le Café");
--    - koppelen vraagt altijd om een gelijkende naam: ten minste 0,35 binnen 75 m,
--      of ten minste 0,15 binnen 25 m (voor "Café Jos" en "Café Jos Meesterschenkerij");
--    - alle kandidaat-paren worden in een keer verdeeld, beste naam eerst, zodat een
--      kroeg niet wordt "weggekaapt" door een buurman die eerder in de lijst stond.

alter table public.kroegen
  drop column google_cid,
  drop column google_beoordeling,
  drop column google_aantal_reviews,
  drop column telefoon,
  drop column website,
  add column openingstijden_bron text check (openingstijden_bron in ('google', 'spelers')),
  add column openingstijden_op timestamptz,
  add column gesloten_door_spelers boolean not null default false;

comment on column public.kroegen.openingstijden is
  'Per dag een lijst als ["16:00-02:00"]; een lege lijst is gesloten. Alle 7 dagen. Uit Google of van spelers.';
comment on column public.kroegen.openingstijden_bron is 'google of spelers; Google overschrijft tijden van spelers niet.';
comment on column public.kroegen.gesloten_door_spelers is 'Door spelers bevestigd definitief gesloten; Google opent hem dan niet opnieuw.';

-- Openingstijden zijn geldig als alle 7 dagen er zijn, elk met een lijst tijden als "16:00-02:00".
create or replace function private.geldige_openingstijden(p jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p is null or (
    jsonb_typeof(p) = 'object'
    and (select count(*) from jsonb_object_keys(p)) = 7
    and (select bool_and(d in ('maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag')) from jsonb_object_keys(p) d)
    and (select bool_and(jsonb_typeof(v) = 'array' and jsonb_array_length(v) <= 4) from jsonb_each(p) e(d, v))
    and coalesce((select bool_and(jsonb_typeof(t) = 'string' and t #>> '{}' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-4]):[0-5][0-9]$')
                  from jsonb_each(p) e(d, v), jsonb_array_elements(v) t), true)
  );
$$;

alter table public.kroegen
  add constraint kroegen_openingstijden_geldig check (private.geldige_openingstijden(openingstijden));

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
  tijden_nieuw boolean;
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
           x ->> 'naam' as naam,
           x ->> 'soort' as soort,
           x ->> 'zekerheid' as zekerheid,
           coalesce(array(select jsonb_array_elements_text(x -> 'categorieen')), '{}') as categorieen,
           nullif(concat_ws(', ', x ->> 'adres', x ->> 'postcode'), '') as adres,
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

    -- Openingstijden alleen als ze geldig zijn, en nooit over tijden van spelers heen.
    select coalesce(k.openingstijden_bron, 'google') = 'google'
           and jsonb_typeof(r.openingstijden) = 'object'
           and private.geldige_openingstijden(r.openingstijden)
      into tijden_nieuw
    from public.kroegen k where k.id = doel;
    tijden_nieuw := coalesce(tijden_nieuw, false);

    -- Een veld dat in deze run ontbreekt, wist de bekende waarde niet.
    update public.kroegen k
    set google_place_id = r.place_id,
        google_categorieen = coalesce(nullif(r.categorieen, '{}'), k.google_categorieen),
        google_zekerheid = r.zekerheid,
        openingstijden = case when tijden_nieuw then r.openingstijden else k.openingstijden end,
        openingstijden_bron = case when tijden_nieuw then 'google' else k.openingstijden_bron end,
        openingstijden_op = case when tijden_nieuw and r.openingstijden is distinct from k.openingstijden then now() else k.openingstijden_op end,
        adres = coalesce(k.adres, r.adres),
        google_laatst_gezien = now(),
        google_gemist = 0,
        -- Alleen-Google-kroegen volgen Google; OSM-kroegen volgen de OSM-import.
        -- Wat spelers definitief gesloten hebben verklaard, blijft dicht.
        naam = case when k.osm_id is null then r.naam else k.naam end,
        locatie = case when k.osm_id is null then r.locatie else k.locatie end,
        open = case when k.osm_id is null and not k.gesloten_door_spelers then true else k.open end
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
revoke all on function private.geldige_openingstijden(jsonb) from public, anon;
grant execute on function private.kroegnaam_kern(text, text) to service_role;
-- De controle op de tabel draait met de rechten van wie schrijft; spelers schrijven via private.meld_kroeg.
grant execute on function private.geldige_openingstijden(jsonb) to authenticated, service_role;
