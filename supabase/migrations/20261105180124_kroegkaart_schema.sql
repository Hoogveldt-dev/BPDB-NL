-- BPDB-NL: Kroegkaart, basisschema
-- Tabellen, toegangsregels (RLS), spellogica, overzichten, realtime en opslag.
-- Zie docs/concept.md (paragraaf 2 en 5) voor de spelregels.

create extension if not exists postgis with schema extensions;

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Typen
-- ---------------------------------------------------------------------------

create type public.gebeurtenis_soort as enum ('eerst', 'wijziging', 'check');
create type public.gebeurtenis_status as enum ('wacht', 'bevestigd', 'weerlegd');
create type public.oordeel as enum ('klopt', 'klopt_niet');

-- ---------------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------------

create table public.profielen (
  id uuid primary key references auth.users (id) on delete cascade,
  naam text not null check (char_length(naam) between 2 and 30),
  betrouwbaarheid numeric(5, 2) not null default 50 check (betrouwbaarheid between 0 and 100),
  is_beheerder boolean not null default false,
  aangemaakt timestamptz not null default now()
);
create unique index profielen_naam_uniek on public.profielen (lower(naam));
comment on table public.profielen is 'Spelers. Alleen naam is door de speler zelf aan te passen.';

create table public.wijken (
  id bigint generated always as identity primary key,
  cbs_code text not null unique,
  naam text not null,
  gemeente text not null,
  geometrie extensions.geography(multipolygon, 4326) not null
);
create index wijken_geometrie_idx on public.wijken using gist (geometrie);

create table public.kroegen (
  id bigint generated always as identity primary key,
  osm_id text unique,
  naam text not null,
  soort text,
  adres text,
  gemeente text not null default 'Nijmegen',
  locatie extensions.geography(point, 4326) not null,
  wijk_id bigint references public.wijken (id) on delete set null,
  open boolean not null default true,
  ontdekker_id uuid references public.profielen (id) on delete set null,
  ontdekt_op timestamptz,
  huidig_merk text,
  huidig_volume_cl smallint,
  huidig_prijs_cent integer,
  prijs_sinds timestamptz,
  laatst_gecontroleerd timestamptz,
  aangemaakt timestamptz not null default now()
);
create index kroegen_locatie_idx on public.kroegen using gist (locatie);
create index kroegen_wijk_idx on public.kroegen (wijk_id);
create index kroegen_ontdekker_idx on public.kroegen (ontdekker_id);
comment on column public.kroegen.huidig_prijs_cent is 'Laatste bevestigde prijs; wordt bijgewerkt door de spellogica.';

create table public.gebeurtenissen (
  id bigint generated always as identity primary key,
  kroeg_id bigint not null references public.kroegen (id) on delete cascade,
  soort public.gebeurtenis_soort not null,
  merk text not null check (char_length(merk) between 2 and 40),
  volume_cl smallint not null check (volume_cl between 15 and 100),
  prijs_cent integer not null check (prijs_cent between 50 and 2500),
  vorige_prijs_cent integer,
  door_id uuid references public.profielen (id) on delete set null,
  op timestamptz not null default now(),
  ter_plaatse boolean not null default false,
  afstand_m integer,
  foto_pad text,
  uitschieter boolean not null default false,
  status public.gebeurtenis_status not null default 'wacht',
  afgerond_op timestamptz
);
create index gebeurtenissen_kroeg_op_idx on public.gebeurtenissen (kroeg_id, op desc);
create index gebeurtenissen_door_idx on public.gebeurtenissen (door_id, op desc);
create index gebeurtenissen_op_idx on public.gebeurtenissen (op desc);
-- Per kroeg hoogstens een openstaande prijsmelding tegelijk.
create unique index gebeurtenissen_een_open_per_kroeg
  on public.gebeurtenissen (kroeg_id) where status = 'wacht';

create table public.bevestigingen (
  id bigint generated always as identity primary key,
  gebeurtenis_id bigint not null references public.gebeurtenissen (id) on delete cascade,
  door_id uuid references public.profielen (id) on delete set null,
  oordeel public.oordeel not null,
  gewicht numeric(3, 1) not null default 1,
  op timestamptz not null default now(),
  unique (gebeurtenis_id, door_id)
);
create index bevestigingen_door_idx on public.bevestigingen (door_id);

create table public.punten (
  id bigint generated always as identity primary key,
  gebruiker_id uuid not null references public.profielen (id) on delete cascade,
  reden text not null,
  punten integer not null,
  gebeurtenis_id bigint references public.gebeurtenissen (id) on delete set null,
  op timestamptz not null default now()
);
create index punten_gebruiker_op_idx on public.punten (gebruiker_id, op desc);
create index punten_op_idx on public.punten (op desc);
create index punten_gebeurtenis_idx on public.punten (gebeurtenis_id);
comment on table public.punten is 'Audit-log van punten; ranglijsten zijn queries hierop.';

-- ---------------------------------------------------------------------------
-- Toegang: iedereen mag lezen, schrijven gaat alleen via de functies hieronder
-- ---------------------------------------------------------------------------

alter table public.profielen enable row level security;
alter table public.wijken enable row level security;
alter table public.kroegen enable row level security;
alter table public.gebeurtenissen enable row level security;
alter table public.bevestigingen enable row level security;
alter table public.punten enable row level security;

revoke all on public.profielen, public.wijken, public.kroegen, public.gebeurtenissen,
  public.bevestigingen, public.punten from anon, authenticated;
grant select on public.profielen, public.wijken, public.kroegen, public.gebeurtenissen,
  public.bevestigingen, public.punten to anon, authenticated;
grant update (naam) on public.profielen to authenticated;

create policy "profielen zijn openbaar" on public.profielen
  for select to anon, authenticated using (true);
create policy "eigen naam aanpassen" on public.profielen
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "wijken zijn openbaar" on public.wijken
  for select to anon, authenticated using (true);
create policy "kroegen zijn openbaar" on public.kroegen
  for select to anon, authenticated using (true);
create policy "gebeurtenissen zijn openbaar" on public.gebeurtenissen
  for select to anon, authenticated using (true);
create policy "bevestigingen zijn openbaar" on public.bevestigingen
  for select to anon, authenticated using (true);
create policy "punten zijn openbaar" on public.punten
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- Nieuw profiel bij registratie
-- ---------------------------------------------------------------------------

create or replace function private.nieuw_profiel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  basis text;
  kandidaat text;
  n integer := 1;
begin
  -- De naam is alleen weergave; autorisatie gebruikt nooit user_metadata.
  basis := coalesce(nullif(trim(new.raw_user_meta_data ->> 'naam'), ''), split_part(new.email, '@', 1), 'speler');
  basis := left(regexp_replace(basis, '[^[:alnum:] _.-]', '', 'g'), 24);
  if char_length(basis) < 2 then
    basis := 'speler';
  end if;
  kandidaat := basis;
  while exists (select 1 from public.profielen p where lower(p.naam) = lower(kandidaat)) loop
    n := n + 1;
    kandidaat := basis || n::text;
  end loop;
  insert into public.profielen (id, naam) values (new.id, kandidaat);
  return new;
end;
$$;

create trigger bij_nieuwe_gebruiker
  after insert on auth.users
  for each row execute function private.nieuw_profiel();

-- ---------------------------------------------------------------------------
-- Spellogica (private, security definer, met eigen controle op auth.uid())
-- ---------------------------------------------------------------------------

-- Mediaan van de prijs per 25 cl over alle bevestigde huidige prijzen in een gemeente.
create or replace function private.mediaan_per25(p_gemeente text)
returns numeric
language sql
stable
set search_path = ''
as $$
  select percentile_cont(0.5) within group (order by k.huidig_prijs_cent * 25.0 / k.huidig_volume_cl)
  from public.kroegen k
  where k.gemeente = p_gemeente and k.huidig_prijs_cent is not null;
$$;

create or replace function private.geef_punten(p_gebruiker uuid, p_reden text, p_punten integer, p_gebeurtenis bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.punten (gebruiker_id, reden, punten, gebeurtenis_id)
  select p_gebruiker, p_reden, p_punten, p_gebeurtenis
  where p_gebruiker is not null;
$$;

create or replace function private.pas_betrouwbaarheid_aan(p_gebruiker uuid, p_delta numeric)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profielen
  set betrouwbaarheid = least(100, greatest(0, betrouwbaarheid + p_delta))
  where id = p_gebruiker;
$$;

-- Rondt een openstaande prijsmelding af als er genoeg oordelen zijn.
create or replace function private.rond_af(p_gebeurtenis bigint)
returns public.gebeurtenis_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.gebeurtenissen;
  voor numeric;
  tegen numeric;
  nodig numeric;
  basis integer;
  b record;
begin
  select * into g from public.gebeurtenissen where id = p_gebeurtenis for update;
  if g.status <> 'wacht' then
    return g.status;
  end if;

  select coalesce(sum(gewicht) filter (where oordeel = 'klopt'), 0),
         coalesce(sum(gewicht) filter (where oordeel = 'klopt_niet'), 0)
    into voor, tegen
  from public.bevestigingen where gebeurtenis_id = g.id;

  -- Normaal: de melder plus een ander (twee bronnen). Uitschieters: twee anderen.
  nodig := case when g.uitschieter then 2 else 1 end;

  -- Weerlegd na twee onafhankelijke 'klopt niet' (of een van een speler boven 90%).
  if tegen >= 2 then
    update public.gebeurtenissen set status = 'weerlegd', afgerond_op = now() where id = g.id;
    perform private.geef_punten(g.door_id, 'weerlegd', -20, g.id);
    perform private.pas_betrouwbaarheid_aan(g.door_id, -10);
    for b in select door_id from public.bevestigingen where gebeurtenis_id = g.id and oordeel = 'klopt_niet' loop
      perform private.geef_punten(b.door_id, 'controle', 5, g.id);
      perform private.pas_betrouwbaarheid_aan(b.door_id, 1);
    end loop;
    for b in select door_id from public.bevestigingen where gebeurtenis_id = g.id and oordeel = 'klopt' loop
      perform private.pas_betrouwbaarheid_aan(b.door_id, -3);
    end loop;
    -- Een weerlegde eerste prijs zet de kroeg terug onder de mist.
    if g.soort = 'eerst' then
      update public.kroegen
      set ontdekker_id = null, ontdekt_op = null
      where id = g.kroeg_id and huidig_prijs_cent is null;
    end if;
    return 'weerlegd';
  end if;

  if voor >= nodig then
    update public.gebeurtenissen set status = 'bevestigd', afgerond_op = now() where id = g.id;
    update public.kroegen
    set huidig_merk = g.merk,
        huidig_volume_cl = g.volume_cl,
        huidig_prijs_cent = g.prijs_cent,
        prijs_sinds = g.op,
        laatst_gecontroleerd = greatest(coalesce(laatst_gecontroleerd, g.op), now())
    where id = g.kroeg_id;

    basis := case g.soort when 'eerst' then 50 else 30 end;
    if g.ter_plaatse then
      basis := round(basis * 1.5);
    end if;
    perform private.geef_punten(g.door_id, case g.soort when 'eerst' then 'vrijgespeeld' else 'prijswijziging' end, basis, g.id);
    if g.foto_pad is not null then
      perform private.geef_punten(g.door_id, 'foto', 5, g.id);
    end if;
    perform private.pas_betrouwbaarheid_aan(g.door_id, 2);
    for b in select door_id from public.bevestigingen where gebeurtenis_id = g.id and oordeel = 'klopt' loop
      perform private.geef_punten(b.door_id, 'bevestiging', 5, g.id);
      perform private.pas_betrouwbaarheid_aan(b.door_id, 1);
    end loop;
    for b in select door_id from public.bevestigingen where gebeurtenis_id = g.id and oordeel = 'klopt_niet' loop
      perform private.pas_betrouwbaarheid_aan(b.door_id, -3);
    end loop;
    return 'bevestigd';
  end if;

  return 'wacht';
end;
$$;

-- Nieuwe prijs melden: vrijspelen (eerste prijs) of een prijswijziging.
create or replace function private.meld_prijs(
  p_kroeg_id bigint,
  p_merk text,
  p_volume_cl integer,
  p_prijs_cent integer,
  p_lat double precision default null,
  p_lon double precision default null,
  p_foto_pad text default null
)
returns public.gebeurtenissen
language plpgsql
security definer
set search_path = ''
as $$
declare
  ik uuid := auth.uid();
  k public.kroegen;
  g public.gebeurtenissen;
  afstand double precision;
  med numeric;
  per25 numeric;
  mijn_betrouwbaarheid numeric;
begin
  if ik is null then
    raise exception 'Log eerst in' using errcode = '28000';
  end if;
  select * into k from public.kroegen where id = p_kroeg_id for update;
  if not found then
    raise exception 'Kroeg bestaat niet' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.gebeurtenissen where kroeg_id = k.id and status = 'wacht') then
    raise exception 'Er staat al een melding open voor deze kroeg; bevestig of weerleg die eerst' using errcode = 'P0001';
  end if;
  if p_foto_pad is not null and split_part(p_foto_pad, '/', 1) <> ik::text then
    raise exception 'Foto hoort niet bij jou' using errcode = '42501';
  end if;
  if k.huidig_prijs_cent is not null and k.huidig_prijs_cent = p_prijs_cent
     and k.huidig_volume_cl = p_volume_cl and lower(k.huidig_merk) = lower(trim(p_merk)) then
    raise exception 'Deze prijs staat er al; tik op "Klopt nog"' using errcode = 'P0001';
  end if;

  if p_lat is not null and p_lon is not null then
    afstand := extensions.st_distance(
      k.locatie,
      extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography);
  end if;

  med := private.mediaan_per25(k.gemeente);
  per25 := p_prijs_cent * 25.0 / p_volume_cl;

  insert into public.gebeurtenissen (
    kroeg_id, soort, merk, volume_cl, prijs_cent, vorige_prijs_cent, door_id,
    ter_plaatse, afstand_m, foto_pad, uitschieter)
  values (
    k.id,
    case when k.huidig_prijs_cent is null then 'eerst' else 'wijziging' end::public.gebeurtenis_soort,
    trim(p_merk), p_volume_cl, p_prijs_cent, k.huidig_prijs_cent, ik,
    coalesce(afstand <= 75, false), round(afstand), p_foto_pad,
    coalesce((select count(*) from public.kroegen where gemeente = k.gemeente and huidig_prijs_cent is not null) >= 5
             and abs(per25 - med) > med * 0.4, false))
  returning * into g;

  if k.ontdekker_id is null then
    update public.kroegen set ontdekker_id = ik, ontdekt_op = now() where id = k.id;
  end if;

  -- Zeer betrouwbare melders hebben geen tweede bron nodig, behalve bij uitschieters.
  select betrouwbaarheid into mijn_betrouwbaarheid from public.profielen where id = ik;
  if mijn_betrouwbaarheid > 90 and not g.uitschieter then
    insert into public.bevestigingen (gebeurtenis_id, door_id, oordeel, gewicht)
    values (g.id, null, 'klopt', 1);
    perform private.rond_af(g.id);
    select * into g from public.gebeurtenissen where id = g.id;
  end if;

  return g;
end;
$$;

-- Een openstaande melding van een ander beoordelen.
create or replace function private.beoordeel(p_gebeurtenis bigint, p_oordeel public.oordeel)
returns public.gebeurtenis_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  ik uuid := auth.uid();
  g public.gebeurtenissen;
  mijn_betrouwbaarheid numeric;
begin
  if ik is null then
    raise exception 'Log eerst in' using errcode = '28000';
  end if;
  select * into g from public.gebeurtenissen where id = p_gebeurtenis;
  if not found then
    raise exception 'Melding bestaat niet' using errcode = 'P0002';
  end if;
  if g.status <> 'wacht' then
    raise exception 'Deze melding is al afgerond' using errcode = 'P0001';
  end if;
  if g.door_id = ik then
    raise exception 'Je kunt je eigen melding niet beoordelen' using errcode = '42501';
  end if;
  select betrouwbaarheid into mijn_betrouwbaarheid from public.profielen where id = ik;
  insert into public.bevestigingen (gebeurtenis_id, door_id, oordeel, gewicht)
  values (g.id, ik, p_oordeel, case when mijn_betrouwbaarheid > 90 and not g.uitschieter then 2 else 1 end)
  on conflict (gebeurtenis_id, door_id) do nothing;
  if not found then
    raise exception 'Je hebt deze melding al beoordeeld' using errcode = 'P0001';
  end if;
  return private.rond_af(g.id);
end;
$$;

-- "Klopt nog": de huidige bevestigde prijs controleren.
create or replace function private.klopt_nog(
  p_kroeg_id bigint,
  p_lat double precision default null,
  p_lon double precision default null
)
returns public.gebeurtenissen
language plpgsql
security definer
set search_path = ''
as $$
declare
  ik uuid := auth.uid();
  k public.kroegen;
  g public.gebeurtenissen;
  afstand double precision;
  oud boolean;
  pt integer;
begin
  if ik is null then
    raise exception 'Log eerst in' using errcode = '28000';
  end if;
  select * into k from public.kroegen where id = p_kroeg_id for update;
  if not found then
    raise exception 'Kroeg bestaat niet' using errcode = 'P0002';
  end if;
  if k.huidig_prijs_cent is null then
    raise exception 'Deze kroeg heeft nog geen bevestigde prijs' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.gebeurtenissen where kroeg_id = k.id and status = 'wacht') then
    raise exception 'Er staat een melding open; beoordeel die in plaats van "Klopt nog"' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.gebeurtenissen
             where kroeg_id = k.id and door_id = ik and soort = 'check' and op > now() - interval '7 days') then
    raise exception 'Je hebt deze kroeg deze week al gecontroleerd' using errcode = 'P0001';
  end if;

  if p_lat is not null and p_lon is not null then
    afstand := extensions.st_distance(
      k.locatie,
      extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography);
  end if;
  oud := coalesce(k.laatst_gecontroleerd, k.prijs_sinds) < now() - interval '90 days';

  insert into public.gebeurtenissen (
    kroeg_id, soort, merk, volume_cl, prijs_cent, door_id, ter_plaatse, afstand_m, status, afgerond_op)
  values (
    k.id, 'check', k.huidig_merk, k.huidig_volume_cl, k.huidig_prijs_cent, ik,
    coalesce(afstand <= 75, false), round(afstand), 'bevestigd', now())
  returning * into g;

  update public.kroegen set laatst_gecontroleerd = now() where id = k.id;

  pt := case when oud then 15 else 5 end;
  if g.ter_plaatse then
    pt := round(pt * 1.5);
  end if;
  perform private.geef_punten(ik, case when oud then 'oude_prijs_gecontroleerd' else 'klopt_nog' end, pt, g.id);
  return g;
end;
$$;

-- Import uit OpenStreetMap (alleen service_role, via de Edge Function osm-import).
create or replace function private.importeer_kroegen(p_kroegen jsonb, p_gemeente text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  aantal integer;
begin
  with rij as (
    select r ->> 'osm_id' as osm_id,
           r ->> 'naam' as naam,
           r ->> 'soort' as soort,
           r ->> 'adres' as adres,
           (r ->> 'lat')::double precision as lat,
           (r ->> 'lon')::double precision as lon
    from jsonb_array_elements(p_kroegen) r
    where coalesce(r ->> 'naam', '') <> ''
  ), upsert as (
    insert into public.kroegen (osm_id, naam, soort, adres, gemeente, locatie)
    select osm_id, naam, soort, adres, p_gemeente,
           extensions.st_setsrid(extensions.st_makepoint(lon, lat), 4326)::extensions.geography
    from rij
    on conflict (osm_id) do update
      set naam = excluded.naam,
          soort = excluded.soort,
          adres = coalesce(excluded.adres, public.kroegen.adres),
          locatie = excluded.locatie,
          open = true
    returning 1
  )
  select count(*) into aantal from upsert;

  -- Kroegen die niet meer in OSM staan sluiten (niet verwijderen: de geschiedenis blijft).
  update public.kroegen
  set open = false
  where gemeente = p_gemeente and osm_id is not null
    and osm_id not in (select r ->> 'osm_id' from jsonb_array_elements(p_kroegen) r);

  perform private.koppel_wijken();
  return aantal;
end;
$$;

create or replace function private.importeer_wijken(p_geojson jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  aantal integer;
begin
  with f as (
    select x -> 'properties' as p, x -> 'geometry' as geo
    from jsonb_array_elements(p_geojson -> 'features') x
  ), upsert as (
    insert into public.wijken (cbs_code, naam, gemeente, geometrie)
    select p ->> 'wijkcode', p ->> 'wijknaam', p ->> 'gemeentenaam',
           extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson(geo::text), 4326))::extensions.geography
    from f
    where p ->> 'wijkcode' is not null
    on conflict (cbs_code) do update
      set naam = excluded.naam, gemeente = excluded.gemeente, geometrie = excluded.geometrie
    returning 1
  )
  select count(*) into aantal from upsert;
  perform private.koppel_wijken();
  return aantal;
end;
$$;

create or replace function private.koppel_wijken()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.kroegen k
  set wijk_id = w.id
  from public.wijken w
  where extensions.st_covers(w.geometrie, k.locatie)
    and k.wijk_id is distinct from w.id;
$$;

revoke all on all functions in schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Publieke RPC's (security invoker; roepen de private functies aan)
-- ---------------------------------------------------------------------------

create or replace function public.meld_prijs(
  p_kroeg_id bigint,
  p_merk text,
  p_volume_cl integer,
  p_prijs_cent integer,
  p_lat double precision default null,
  p_lon double precision default null,
  p_foto_pad text default null
)
returns public.gebeurtenissen
language sql
security invoker
set search_path = ''
as $$
  select * from private.meld_prijs(p_kroeg_id, p_merk, p_volume_cl, p_prijs_cent, p_lat, p_lon, p_foto_pad);
$$;

create or replace function public.beoordeel(p_gebeurtenis bigint, p_oordeel public.oordeel)
returns public.gebeurtenis_status
language sql
security invoker
set search_path = ''
as $$
  select private.beoordeel(p_gebeurtenis, p_oordeel);
$$;

create or replace function public.klopt_nog(
  p_kroeg_id bigint,
  p_lat double precision default null,
  p_lon double precision default null
)
returns public.gebeurtenissen
language sql
security invoker
set search_path = ''
as $$
  select * from private.klopt_nog(p_kroeg_id, p_lat, p_lon);
$$;

create or replace function public.importeer_kroegen(p_kroegen jsonb, p_gemeente text)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.importeer_kroegen(p_kroegen, p_gemeente);
$$;

create or replace function public.importeer_wijken(p_geojson jsonb)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.importeer_wijken(p_geojson);
$$;

revoke all on function public.meld_prijs, public.beoordeel, public.klopt_nog,
  public.importeer_kroegen, public.importeer_wijken from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;
grant execute on function public.meld_prijs, public.beoordeel, public.klopt_nog to authenticated;
grant execute on function private.meld_prijs, private.beoordeel, private.klopt_nog to authenticated;
grant execute on function public.importeer_kroegen, public.importeer_wijken to service_role;
grant execute on function private.importeer_kroegen, private.importeer_wijken to service_role;

-- ---------------------------------------------------------------------------
-- Overzichten (security_invoker, dus RLS van de onderliggende tabellen geldt)
-- ---------------------------------------------------------------------------

create or replace view public.kroeg_kaart
with (security_invoker = true)
as
select
  k.id,
  k.naam,
  k.soort,
  k.adres,
  k.gemeente,
  k.open,
  extensions.st_y(k.locatie::extensions.geometry) as lat,
  extensions.st_x(k.locatie::extensions.geometry) as lon,
  k.wijk_id,
  w.naam as wijk,
  k.ontdekker_id,
  o.naam as ontdekker,
  k.ontdekt_op,
  k.huidig_merk,
  k.huidig_volume_cl,
  k.huidig_prijs_cent,
  case when k.huidig_prijs_cent is not null
       then round(k.huidig_prijs_cent * 25.0 / k.huidig_volume_cl)::integer end as per25_cent,
  k.prijs_sinds,
  k.laatst_gecontroleerd,
  case
    when k.ontdekker_id is null then 'locked'
    when k.laatst_gecontroleerd is null then 'wacht'
    when k.laatst_gecontroleerd > now() - interval '30 days' then 'fresh'
    when k.laatst_gecontroleerd > now() - interval '90 days' then 'stale'
    else 'old'
  end as versheid,
  open_melding.id as open_melding_id
from public.kroegen k
left join public.wijken w on w.id = k.wijk_id
left join public.profielen o on o.id = k.ontdekker_id
left join lateral (
  select g.id from public.gebeurtenissen g where g.kroeg_id = k.id and g.status = 'wacht' limit 1
) open_melding on true;

create or replace view public.kroeg_tijdlijn
with (security_invoker = true)
as
select
  g.id,
  g.kroeg_id,
  k.naam as kroeg,
  g.soort,
  g.status,
  g.merk,
  g.volume_cl,
  g.prijs_cent,
  g.vorige_prijs_cent,
  g.op,
  g.door_id,
  p.naam as door,
  g.ter_plaatse,
  g.foto_pad,
  g.uitschieter,
  coalesce(
    (select array_agg(bp.naam order by b.op)
     from public.bevestigingen b join public.profielen bp on bp.id = b.door_id
     where b.gebeurtenis_id = g.id and b.oordeel = 'klopt'), '{}') as bevestigd_door,
  coalesce(
    (select array_agg(bp.naam order by b.op)
     from public.bevestigingen b join public.profielen bp on bp.id = b.door_id
     where b.gebeurtenis_id = g.id and b.oordeel = 'klopt_niet'), '{}') as weerlegd_door
from public.gebeurtenissen g
join public.kroegen k on k.id = g.kroeg_id
left join public.profielen p on p.id = g.door_id;

create or replace view public.ranglijst
with (security_invoker = true)
as
select
  p.id,
  p.naam,
  p.betrouwbaarheid,
  coalesce(sum(pt.punten), 0)::integer as altijd,
  coalesce(sum(pt.punten) filter (where pt.op > now() - interval '30 days'), 0)::integer as maand,
  coalesce(sum(pt.punten) filter (where pt.op > now() - interval '7 days'), 0)::integer as week,
  (select count(*) from public.kroegen k where k.ontdekker_id = p.id)::integer as ontdekt
from public.profielen p
left join public.punten pt on pt.gebruiker_id = p.id
group by p.id;

create or replace view public.stad_voortgang
with (security_invoker = true)
as
select
  k.gemeente,
  count(*)::integer as kroegen,
  count(k.ontdekker_id)::integer as vrijgespeeld,
  count(*) filter (where k.laatst_gecontroleerd > now() - interval '30 days')::integer as vers,
  count(*) filter (where k.laatst_gecontroleerd <= now() - interval '90 days')::integer as oud,
  (select count(*) from public.gebeurtenissen g join public.kroegen k2 on k2.id = g.kroeg_id
   where k2.gemeente = k.gemeente and g.op > now() - interval '7 days' and g.status <> 'weerlegd')::integer as bijdragen_week,
  (select count(distinct g.door_id) from public.gebeurtenissen g join public.kroegen k2 on k2.id = g.kroeg_id
   where k2.gemeente = k.gemeente and g.op > now() - interval '7 days' and g.status <> 'weerlegd')::integer as spelers_week,
  round(private_mediaan.m)::integer as mediaan_per25_cent
from public.kroegen k
cross join lateral (
  select percentile_cont(0.5) within group (order by k3.huidig_prijs_cent * 25.0 / k3.huidig_volume_cl) as m
  from public.kroegen k3 where k3.gemeente = k.gemeente and k3.huidig_prijs_cent is not null
) private_mediaan
where k.open
group by k.gemeente, private_mediaan.m;

create or replace view public.wijk_voortgang
with (security_invoker = true)
as
select
  w.id,
  w.naam,
  w.gemeente,
  count(k.id)::integer as kroegen,
  count(k.ontdekker_id)::integer as vrijgespeeld,
  count(k.id) filter (where k.laatst_gecontroleerd > now() - interval '30 days')::integer as vers
from public.wijken w
left join public.kroegen k on k.wijk_id = w.id and k.open
group by w.id
having count(k.id) > 0;

grant select on public.kroeg_kaart, public.kroeg_tijdlijn, public.ranglijst,
  public.stad_voortgang, public.wijk_voortgang to anon, authenticated;

-- Kroegen bij een locatie, dichtstbijzijnde eerst.
create or replace function public.kroegen_in_de_buurt(
  p_lat double precision,
  p_lon double precision,
  p_straal_m integer default 1500
)
returns table (id bigint, naam text, versheid text, per25_cent integer, afstand_m integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select kk.id, kk.naam, kk.versheid, kk.per25_cent,
         round(extensions.st_distance(k.locatie, here.p))::integer
  from public.kroegen k
  join public.kroeg_kaart kk on kk.id = k.id
  cross join (select extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography as p) here
  where k.open and extensions.st_dwithin(k.locatie, here.p, least(p_straal_m, 10000))
  order by k.locatie operator(extensions.<->) here.p
  limit 100;
$$;
grant execute on function public.kroegen_in_de_buurt to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: nieuwe meldingen en prijzen direct zichtbaar
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.gebeurtenissen, public.kroegen, public.bevestigingen;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Opslag: foto's van prijslijsten
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('prijslijsten', 'prijslijsten', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create policy "foto uploaden in eigen map" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'prijslijsten'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "eigen foto verwijderen" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'prijslijsten'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
