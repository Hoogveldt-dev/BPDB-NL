-- BPDB-NL: extra bier per kroeg
-- Het spel (vrijspelen, punten, ranglijst, versheid) draait om de goedkoopste pils van de tap in een vaasje
-- (25 cl); dat blijft in kroegen.huidig_* en gebeurtenissen. Daarnaast kan iedereen vastleggen wat een kroeg
-- nog meer tapt, zoals Guinness, witbier of een ander merk pils, met of zonder prijs. Zo kun je filteren op
-- kroegen met Guinness en die prijzen vergelijken. Extra's leveren (voorlopig) geen punten op en hoeven daarom
-- niet bevestigd te worden. Anderen kunnen ze wel bevestigen ("klopt") of afkeuren ("klopt niet"); twee keer
-- "klopt niet" en het bier verdwijnt. Niets wordt verwijderd: een nieuwe prijs vervangt de oude.

-- ---------------------------------------------------------------------------
-- Soorten bier (vaste lijst; uitbreiden met een nieuwe migratie)
-- ---------------------------------------------------------------------------

create table public.biersoorten (
  code text primary key check (code ~ '^[a-z_]+$'),
  naam text not null,
  volgorde smallint not null default 100
);

insert into public.biersoorten (code, naam, volgorde) values
  ('pils', 'Pils, ander merk of glas', 10),
  ('guinness', 'Guinness', 20),
  ('stout', 'Stout of porter', 30),
  ('witbier', 'Witbier', 40),
  ('weizen', 'Weizen', 50),
  ('ipa', 'IPA', 60),
  ('blond', 'Blond', 70),
  ('dubbel', 'Dubbel', 80),
  ('tripel', 'Tripel', 90),
  ('bokbier', 'Bokbier', 100),
  ('alcoholvrij', 'Alcoholvrij bier', 110),
  ('speciaal', 'Ander speciaalbier', 120);

-- ---------------------------------------------------------------------------
-- Wat een kroeg tapt
-- ---------------------------------------------------------------------------

create type public.aanbod_status as enum ('actief', 'vervangen', 'weg');

create table public.kroeg_aanbod (
  id bigint generated always as identity primary key,
  kroeg_id bigint not null references public.kroegen (id) on delete cascade,
  soort text not null references public.biersoorten (code),
  merk text check (merk is null or char_length(merk) between 2 and 40),
  volume_cl smallint check (volume_cl is null or volume_cl between 15 and 100),
  prijs_cent integer check (prijs_cent is null or prijs_cent between 50 and 2500),
  door_id uuid references public.profielen (id) on delete set null,
  op timestamptz not null default now(),
  gecontroleerd_op timestamptz,
  status public.aanbod_status not null default 'actief',
  afgerond_op timestamptz,
  -- Een prijs zegt alleen iets met een glasmaat erbij
  check (prijs_cent is null or volume_cl is not null)
);
create index kroeg_aanbod_kroeg_idx on public.kroeg_aanbod (kroeg_id) where status = 'actief';
create index kroeg_aanbod_soort_idx on public.kroeg_aanbod (soort) where status = 'actief';
create index kroeg_aanbod_door_idx on public.kroeg_aanbod (door_id);
-- Hetzelfde bier in hetzelfde glas staat er per kroeg hoogstens een keer
create unique index kroeg_aanbod_uniek
  on public.kroeg_aanbod (kroeg_id, soort, lower(coalesce(merk, '')), coalesce(volume_cl, 0))
  where status = 'actief';
comment on table public.kroeg_aanbod is 'Extra bier per kroeg naast de pils van het spel; geen punten. Alleen via meld_aanbod en beoordeel_aanbod.';

create table public.aanbod_oordelen (
  id bigint generated always as identity primary key,
  aanbod_id bigint not null references public.kroeg_aanbod (id) on delete cascade,
  door_id uuid references public.profielen (id) on delete set null,
  oordeel public.oordeel not null,
  op timestamptz not null default now(),
  unique (aanbod_id, door_id)
);
create index aanbod_oordelen_door_idx on public.aanbod_oordelen (door_id);

alter table public.biersoorten enable row level security;
alter table public.kroeg_aanbod enable row level security;
alter table public.aanbod_oordelen enable row level security;

revoke all on public.biersoorten, public.kroeg_aanbod, public.aanbod_oordelen from anon, authenticated;
grant select on public.biersoorten, public.kroeg_aanbod, public.aanbod_oordelen to anon, authenticated;

create policy "biersoorten zijn openbaar" on public.biersoorten for select to anon, authenticated using (true);
create policy "aanbod is openbaar" on public.kroeg_aanbod for select to anon, authenticated using (true);
create policy "oordelen over aanbod zijn openbaar" on public.aanbod_oordelen for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- Functies
-- ---------------------------------------------------------------------------

-- Bier toevoegen of een nieuwe prijs melden. Ook anonieme spelers mogen dit; er zijn geen punten mee te verdienen.
create or replace function private.meld_aanbod(
  p_kroeg_id bigint,
  p_soort text,
  p_merk text default null,
  p_volume_cl integer default null,
  p_prijs_cent integer default null
)
returns public.kroeg_aanbod
language plpgsql
security definer
set search_path = ''
as $$
declare
  ik uuid := auth.uid();
  m text := nullif(trim(p_merk), '');
  oud public.kroeg_aanbod;
  a public.kroeg_aanbod;
begin
  if ik is null then
    raise exception 'Log eerst in' using errcode = '28000';
  end if;
  if not exists (select 1 from public.kroegen where id = p_kroeg_id) then
    raise exception 'Kroeg bestaat niet' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.biersoorten where code = p_soort) then
    raise exception 'Kies een soort bier uit de lijst' using errcode = 'P0001';
  end if;
  if p_prijs_cent is not null and p_volume_cl is null then
    raise exception 'Vul ook de glasmaat in bij een prijs' using errcode = 'P0001';
  end if;
  if p_soort = 'guinness' then
    m := coalesce(m, 'Guinness');
  end if;

  select * into oud from public.kroeg_aanbod
  where kroeg_id = p_kroeg_id and soort = p_soort and status = 'actief'
    and lower(coalesce(merk, '')) = lower(coalesce(m, '')) and coalesce(volume_cl, 0) = coalesce(p_volume_cl, 0)
  for update;
  if found then
    if p_prijs_cent is null or oud.prijs_cent = p_prijs_cent then
      raise exception 'Dit bier staat er al; tik op "Klopt" als het nog zo is' using errcode = 'P0001';
    end if;
    -- Een nieuwe prijs vervangt de oude; de oude blijft bewaard als geschiedenis
    update public.kroeg_aanbod set status = 'vervangen', afgerond_op = now() where id = oud.id;
  end if;

  insert into public.kroeg_aanbod (kroeg_id, soort, merk, volume_cl, prijs_cent, door_id)
  values (p_kroeg_id, p_soort, m, p_volume_cl, p_prijs_cent, ik)
  returning * into a;
  return a;
end;
$$;

-- "Klopt" of "klopt niet" bij bier van een ander (alleen met e-mailadres). Twee keer "klopt niet" en het
-- bier verdwijnt. Wie het zelf heeft gemeld, kan het met "klopt niet" meteen intrekken.
create or replace function private.beoordeel_aanbod(p_aanbod_id bigint, p_oordeel public.oordeel)
returns public.aanbod_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  ik uuid := auth.uid();
  a public.kroeg_aanbod;
  tegen integer;
begin
  if ik is null then
    raise exception 'Log eerst in' using errcode = '28000';
  end if;
  select * into a from public.kroeg_aanbod where id = p_aanbod_id for update;
  if not found then
    raise exception 'Dit bier bestaat niet' using errcode = 'P0002';
  end if;
  if a.status <> 'actief' then
    raise exception 'Dit bier staat er niet meer' using errcode = 'P0001';
  end if;

  if a.door_id = ik then
    if p_oordeel = 'klopt' then
      raise exception 'Je kunt je eigen melding niet bevestigen' using errcode = '42501';
    end if;
    update public.kroeg_aanbod set status = 'weg', afgerond_op = now() where id = a.id;
    return 'weg';
  end if;

  perform private.vereis_email();
  -- Een nieuw oordeel van dezelfde speler vervangt het vorige (bijvoorbeeld als het later van de tap is)
  insert into public.aanbod_oordelen (aanbod_id, door_id, oordeel)
  values (a.id, ik, p_oordeel)
  on conflict (aanbod_id, door_id) do update set oordeel = excluded.oordeel, op = now();

  if p_oordeel = 'klopt' then
    update public.kroeg_aanbod set gecontroleerd_op = now() where id = a.id;
    return 'actief';
  end if;

  select count(*) into tegen from public.aanbod_oordelen where aanbod_id = a.id and oordeel = 'klopt_niet';
  if tegen >= 2 then
    update public.kroeg_aanbod set status = 'weg', afgerond_op = now() where id = a.id;
    return 'weg';
  end if;
  return 'actief';
end;
$$;

revoke all on function private.meld_aanbod, private.beoordeel_aanbod from public, anon, authenticated;

create or replace function public.meld_aanbod(
  p_kroeg_id bigint,
  p_soort text,
  p_merk text default null,
  p_volume_cl integer default null,
  p_prijs_cent integer default null
)
returns public.kroeg_aanbod
language sql
security invoker
set search_path = ''
as $$
  select * from private.meld_aanbod(p_kroeg_id, p_soort, p_merk, p_volume_cl, p_prijs_cent);
$$;

create or replace function public.beoordeel_aanbod(p_aanbod_id bigint, p_oordeel public.oordeel)
returns public.aanbod_status
language sql
security invoker
set search_path = ''
as $$
  select private.beoordeel_aanbod(p_aanbod_id, p_oordeel);
$$;

revoke all on function public.meld_aanbod, public.beoordeel_aanbod from public, anon, authenticated;
grant execute on function public.meld_aanbod, public.beoordeel_aanbod to authenticated;
grant execute on function private.meld_aanbod, private.beoordeel_aanbod to authenticated;

-- ---------------------------------------------------------------------------
-- Overzicht voor de app: alleen wat er nu getapt wordt
-- ---------------------------------------------------------------------------

create or replace view public.aanbod_overzicht
with (security_invoker = true)
as
select
  a.id,
  a.kroeg_id,
  k.gemeente,
  a.soort,
  s.naam as soort_naam,
  s.volgorde,
  a.merk,
  a.volume_cl,
  a.prijs_cent,
  a.op,
  a.gecontroleerd_op,
  a.door_id,
  p.naam as door,
  (select count(*) from public.aanbod_oordelen o where o.aanbod_id = a.id and o.oordeel = 'klopt_niet')::integer as klopt_niet
from public.kroeg_aanbod a
join public.kroegen k on k.id = a.kroeg_id
join public.biersoorten s on s.code = a.soort
left join public.profielen p on p.id = a.door_id
where a.status = 'actief';

grant select on public.aanbod_overzicht to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.kroeg_aanbod;
  end if;
end;
$$;
