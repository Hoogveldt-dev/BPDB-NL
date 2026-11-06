-- BPDB-NL: inchecken en Mijn kroegen
-- Naast de gezamenlijke kaart houdt elke speler een eigen kaart bij: de kroegen waar hij
-- zelf is geweest. Een kroeg wordt op jouw kaart ontgrendeld door in te checken.
-- Zie docs/concept.md, paragraaf 2.8 en 2.9.
--
-- Regels:
--   * Inchecken kan alleen ter plaatse: binnen 75 m van de kroeg (zelfde grens als bij melden).
--   * Hoogstens een keer per kroeg per dag (Nederlandse tijd).
--   * Een prijsmelding of "klopt nog" ter plaatse telt automatisch als check-in.
--   * Inchecken levert geen punten op: we belonen bijdragen, nooit kroegbezoek of drinken.
--   * Check-ins zijn privé: alleen de speler zelf kan ze lezen en wissen (AVG: dit is
--     locatiegeschiedenis). Niemand anders ziet waar en wanneer je was.

create table public.incheckingen (
  id bigint generated always as identity primary key,
  gebruiker_id uuid not null references public.profielen (id) on delete cascade,
  kroeg_id bigint not null references public.kroegen (id) on delete cascade,
  op timestamptz not null default now(),
  dag date not null default ((now() at time zone 'Europe/Amsterdam')::date),
  afstand_m integer,
  bron text not null default 'inchecken' check (bron in ('inchecken', 'melding', 'controle')),
  unique (gebruiker_id, kroeg_id, dag)
);
create index incheckingen_gebruiker_op_idx on public.incheckingen (gebruiker_id, op desc);
create index incheckingen_kroeg_idx on public.incheckingen (kroeg_id);
comment on table public.incheckingen is
  'Persoonlijke check-ins per speler en kroeg, hoogstens een per dag. Privé: alleen zichtbaar voor de speler zelf.';

alter table public.incheckingen enable row level security;
revoke all on public.incheckingen from anon, authenticated;
grant select, delete on public.incheckingen to authenticated;

create policy "eigen check-ins lezen" on public.incheckingen
  for select to authenticated
  using ((select auth.uid()) = gebruiker_id);
create policy "eigen check-ins wissen" on public.incheckingen
  for delete to authenticated
  using ((select auth.uid()) = gebruiker_id);

-- ---------------------------------------------------------------------------
-- Inchecken
-- ---------------------------------------------------------------------------

create or replace function private.inchecken(
  p_kroeg_id bigint,
  p_lat double precision,
  p_lon double precision
)
returns public.incheckingen
language plpgsql
security definer
set search_path = ''
as $$
declare
  ik uuid := auth.uid();
  k public.kroegen;
  afstand double precision;
  i public.incheckingen;
begin
  if ik is null then
    raise exception 'Log eerst in' using errcode = '28000';
  end if;
  if p_lat is null or p_lon is null then
    raise exception 'Zet je locatie aan om in te checken' using errcode = 'P0001';
  end if;
  select * into k from public.kroegen where id = p_kroeg_id;
  if not found or not k.open then
    raise exception 'Kroeg bestaat niet' using errcode = 'P0002';
  end if;

  afstand := extensions.st_distance(
    k.locatie,
    extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography);
  if afstand > 75 then
    raise exception 'Je bent % m van deze kroeg. Inchecken kan binnen 75 m.', round(afstand)
      using errcode = 'P0001';
  end if;

  insert into public.incheckingen (gebruiker_id, kroeg_id, afstand_m, bron)
  values (ik, k.id, round(afstand), 'inchecken')
  on conflict (gebruiker_id, kroeg_id, dag) do nothing
  returning * into i;
  if not found then
    raise exception 'Je bent hier vandaag al ingecheckt' using errcode = 'P0001';
  end if;
  return i;
end;
$$;

-- Een melding of controle ter plaatse is ook een check-in.
create or replace function private.incheck_bij_gebeurtenis()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ter_plaatse and new.door_id is not null then
    insert into public.incheckingen (gebruiker_id, kroeg_id, op, dag, afstand_m, bron)
    values (new.door_id, new.kroeg_id, new.op, (new.op at time zone 'Europe/Amsterdam')::date, new.afstand_m,
            case when new.soort = 'check' then 'controle' else 'melding' end)
    on conflict (gebruiker_id, kroeg_id, dag) do nothing;
  end if;
  return new;
end;
$$;

create trigger incheck_bij_gebeurtenis
  after insert on public.gebeurtenissen
  for each row execute function private.incheck_bij_gebeurtenis();

revoke all on function private.inchecken, private.incheck_bij_gebeurtenis from public, anon, authenticated;
grant execute on function private.inchecken to authenticated;

create or replace function public.inchecken(
  p_kroeg_id bigint,
  p_lat double precision,
  p_lon double precision
)
returns public.incheckingen
language sql
security invoker
set search_path = ''
as $$
  select * from private.inchecken(p_kroeg_id, p_lat, p_lon);
$$;

revoke all on function public.inchecken from public, anon, authenticated;
grant execute on function public.inchecken to authenticated;

-- ---------------------------------------------------------------------------
-- Mijn kroegen: per kroeg hoe vaak en wanneer jij er was
-- ---------------------------------------------------------------------------

create or replace view public.mijn_kroegen
with (security_invoker = true)
as
select
  i.kroeg_id,
  count(*)::integer as keer,
  min(i.op) as eerste,
  max(i.op) as laatst
from public.incheckingen i
where i.gebruiker_id = (select auth.uid())
group by i.kroeg_id;

comment on view public.mijn_kroegen is
  'Per kroeg het aantal check-ins van de ingelogde speler, met eerste en laatste bezoek.';

revoke all on public.mijn_kroegen from anon, authenticated;
grant select on public.mijn_kroegen to authenticated;
