-- Spelers houden openingstijden en sluitingen bij.
--
-- Openingstijden komen uit Google (tools/google-kroegen), maar kloppen niet altijd.
-- Google laat definitief gesloten zaken bovendien gewoon weg, en een kroeg die alleen
-- in OpenStreetMap staat, blijft daar soms jaren staan. Daarom kunnen spelers melden:
--
--   openingstijden  Geldt meteen (net als extra bier: geen punten, dus weinig reden om
--                   te knoeien). Een ander kan "klopt" zeggen; twee keer "klopt niet"
--                   (of de melder trekt hem in) en de vorige tijden komen terug.
--   gesloten        Ingrijpend: de kroeg verdwijnt van de kaart. Daarom pas na "klopt"
--                   van een andere speler met e-mailadres. Twee keer "klopt niet" en de
--                   melding is weerlegd.
--
-- Meldingen leveren geen punten op. Anonieme spelers mogen melden, niet oordelen
-- (private.vereis_email). Per kroeg staat er per soort hoogstens een melding open.
-- Wat spelers vastleggen, gaat voor: Google overschrijft hun openingstijden niet, en
-- Google en OSM openen een door spelers gesloten kroeg niet opnieuw.

create type public.kroegmelding_soort as enum ('openingstijden', 'gesloten');

create table public.kroeg_meldingen (
  id bigint generated always as identity primary key,
  kroeg_id bigint not null references public.kroegen (id) on delete cascade,
  soort public.kroegmelding_soort not null,
  openingstijden jsonb check (private.geldige_openingstijden(openingstijden)),
  vorige_openingstijden jsonb,
  vorige_bron text,
  door_id uuid references public.profielen (id) on delete set null,
  op timestamptz not null default now(),
  status public.gebeurtenis_status not null default 'wacht',
  afgerond_op timestamptz,
  check ((soort = 'openingstijden') = (openingstijden is not null))
);
create index kroeg_meldingen_kroeg_idx on public.kroeg_meldingen (kroeg_id);
create index kroeg_meldingen_door_idx on public.kroeg_meldingen (door_id);
create unique index kroeg_meldingen_een_open
  on public.kroeg_meldingen (kroeg_id, soort) where status = 'wacht';
comment on table public.kroeg_meldingen is 'Openingstijden en sluitingen gemeld door spelers; geen punten. Alleen via meld_kroeg en beoordeel_kroegmelding.';

create table public.kroegmelding_oordelen (
  id bigint generated always as identity primary key,
  melding_id bigint not null references public.kroeg_meldingen (id) on delete cascade,
  door_id uuid references public.profielen (id) on delete set null,
  oordeel public.oordeel not null,
  op timestamptz not null default now(),
  unique (melding_id, door_id)
);
create index kroegmelding_oordelen_door_idx on public.kroegmelding_oordelen (door_id);

alter table public.kroeg_meldingen enable row level security;
alter table public.kroegmelding_oordelen enable row level security;
revoke all on public.kroeg_meldingen, public.kroegmelding_oordelen from anon, authenticated;
grant select on public.kroeg_meldingen, public.kroegmelding_oordelen to anon, authenticated;
create policy "kroegmeldingen zijn openbaar" on public.kroeg_meldingen for select to anon, authenticated using (true);
create policy "oordelen over kroegmeldingen zijn openbaar" on public.kroegmelding_oordelen for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- Functies
-- ---------------------------------------------------------------------------

create or replace function private.meld_kroeg(
  p_kroeg_id bigint,
  p_soort public.kroegmelding_soort,
  p_openingstijden jsonb default null
)
returns public.kroeg_meldingen
language plpgsql
security definer
set search_path = ''
as $$
declare
  ik uuid := auth.uid();
  k public.kroegen;
  m public.kroeg_meldingen;
begin
  if ik is null then
    raise exception 'Log eerst in' using errcode = '28000';
  end if;
  select * into k from public.kroegen where id = p_kroeg_id for update;
  if not found then
    raise exception 'Kroeg bestaat niet' using errcode = 'P0002';
  end if;
  if not k.open then
    raise exception 'Deze kroeg staat al als gesloten' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.kroeg_meldingen where kroeg_id = k.id and soort = p_soort and status = 'wacht') then
    raise exception 'Er staat al een melding open; zeg "Klopt" of "Klopt niet"' using errcode = 'P0001';
  end if;

  if p_soort = 'openingstijden' then
    if p_openingstijden is null or not private.geldige_openingstijden(p_openingstijden) then
      raise exception 'Vul voor elke dag tijden in als 16:00-02:00, of laat de dag leeg als hij dicht is' using errcode = 'P0001';
    end if;
    if p_openingstijden = k.openingstijden then
      raise exception 'Dit zijn de tijden die er al staan' using errcode = 'P0001';
    end if;
    insert into public.kroeg_meldingen (kroeg_id, soort, openingstijden, vorige_openingstijden, vorige_bron, door_id)
    values (k.id, 'openingstijden', p_openingstijden, k.openingstijden, k.openingstijden_bron, ik)
    returning * into m;
    update public.kroegen
    set openingstijden = p_openingstijden, openingstijden_bron = 'spelers', openingstijden_op = now()
    where id = k.id;
  else
    if p_openingstijden is not null then
      raise exception 'Bij een sluiting horen geen openingstijden' using errcode = 'P0001';
    end if;
    insert into public.kroeg_meldingen (kroeg_id, soort, door_id)
    values (k.id, 'gesloten', ik)
    returning * into m;
  end if;
  return m;
end;
$$;

-- "Klopt" of "klopt niet" (alleen met e-mailadres). De melder kan alleen intrekken ("klopt niet").
create or replace function private.beoordeel_kroegmelding(p_melding_id bigint, p_oordeel public.oordeel)
returns public.gebeurtenis_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  ik uuid := auth.uid();
  m public.kroeg_meldingen;
  tegen integer;
  nieuw public.gebeurtenis_status := 'wacht';
begin
  if ik is null then
    raise exception 'Log eerst in' using errcode = '28000';
  end if;
  select * into m from public.kroeg_meldingen where id = p_melding_id for update;
  if not found then
    raise exception 'Deze melding bestaat niet' using errcode = 'P0002';
  end if;
  if m.status <> 'wacht' then
    raise exception 'Over deze melding is al besloten' using errcode = 'P0001';
  end if;

  if m.door_id = ik then
    if p_oordeel = 'klopt' then
      raise exception 'Je kunt je eigen melding niet bevestigen' using errcode = '42501';
    end if;
    nieuw := 'weerlegd';
  else
    perform private.vereis_email();
    insert into public.kroegmelding_oordelen (melding_id, door_id, oordeel)
    values (m.id, ik, p_oordeel)
    on conflict (melding_id, door_id) do update set oordeel = excluded.oordeel, op = now();

    if p_oordeel = 'klopt' then
      nieuw := 'bevestigd';
    else
      select count(*) into tegen from public.kroegmelding_oordelen where melding_id = m.id and oordeel = 'klopt_niet';
      if tegen >= 2 then
        nieuw := 'weerlegd';
      end if;
    end if;
  end if;

  if nieuw = 'wacht' then
    return nieuw;
  end if;
  update public.kroeg_meldingen set status = nieuw, afgerond_op = now() where id = m.id;

  if m.soort = 'gesloten' and nieuw = 'bevestigd' then
    update public.kroegen set open = false, gesloten_door_spelers = true where id = m.kroeg_id;
  elsif m.soort = 'openingstijden' and nieuw = 'weerlegd' then
    -- Vorige tijden terug, tenzij er sindsdien al iets anders staat
    update public.kroegen
    set openingstijden = m.vorige_openingstijden, openingstijden_bron = m.vorige_bron, openingstijden_op = now()
    where id = m.kroeg_id and openingstijden = m.openingstijden;
  end if;
  return nieuw;
end;
$$;

revoke all on function private.meld_kroeg, private.beoordeel_kroegmelding from public, anon, authenticated;

create or replace function public.meld_kroeg(
  p_kroeg_id bigint,
  p_soort public.kroegmelding_soort,
  p_openingstijden jsonb default null
)
returns public.kroeg_meldingen
language sql
security invoker
set search_path = ''
as $$
  select * from private.meld_kroeg(p_kroeg_id, p_soort, p_openingstijden);
$$;

create or replace function public.beoordeel_kroegmelding(p_melding_id bigint, p_oordeel public.oordeel)
returns public.gebeurtenis_status
language sql
security invoker
set search_path = ''
as $$
  select private.beoordeel_kroegmelding(p_melding_id, p_oordeel);
$$;

revoke all on function public.meld_kroeg, public.beoordeel_kroegmelding from public, anon, authenticated;
grant execute on function public.meld_kroeg, public.beoordeel_kroegmelding to authenticated;
grant execute on function private.meld_kroeg, private.beoordeel_kroegmelding to authenticated;

-- ---------------------------------------------------------------------------
-- Overzicht voor de app: openingstijden en open meldingen per kroeg
-- ---------------------------------------------------------------------------

create or replace view public.kroeg_info
with (security_invoker = true)
as
select
  k.id as kroeg_id,
  k.openingstijden,
  k.openingstijden_bron,
  k.openingstijden_op,
  (select jsonb_agg(jsonb_build_object(
            'id', m.id, 'soort', m.soort, 'op', m.op, 'door_id', m.door_id, 'door', p.naam,
            'klopt_niet', (select count(*) from public.kroegmelding_oordelen o where o.melding_id = m.id and o.oordeel = 'klopt_niet'))
          order by m.op)
   from public.kroeg_meldingen m
   left join public.profielen p on p.id = m.door_id
   where m.kroeg_id = k.id and m.status = 'wacht') as open_meldingen
from public.kroegen k;

grant select on public.kroeg_info to anon, authenticated;

-- ---------------------------------------------------------------------------
-- De OSM-import opent een door spelers gesloten kroeg niet opnieuw
-- ---------------------------------------------------------------------------

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
          open = not public.kroegen.gesloten_door_spelers
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

revoke all on function private.importeer_kroegen(jsonb, text) from public, anon, authenticated;
grant execute on function private.importeer_kroegen(jsonb, text) to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.kroeg_meldingen;
  end if;
end;
$$;
