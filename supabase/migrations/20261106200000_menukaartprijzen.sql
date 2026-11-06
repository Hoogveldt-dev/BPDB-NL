-- Prijzen van menukaarten als eerste stuk prijsgeschiedenis.
--
-- Een menukaart met datum (een foto van een bezoeker, de website van de kroeg) vertelt
-- al wat een vaasje ergens kostte. Zo'n prijs komt als gebeurtenis in de geschiedenis,
-- met bron 'menukaart', de datum van de kaart en zonder melder. Zo staat er bij elke
-- kroeg al een bedrag klaar en hoeft niemand naar een kroeg waar niets bekend is.
--
-- Spelregels (besluit Kjell, 6 november 2026):
--   - Een menukaartprijs speelt een kroeg niet vrij en levert niemand punten op. De kroeg
--     blijft onder de mist tot een speler de prijs heeft bevestigd.
--   - Dezelfde prijs melden ("Klopt nog") kan alleen ter plaatse (binnen 75 m). De speler
--     wordt dan indiener en ontdekker, en daarna gelden de gewone regels: een andere speler
--     moet bevestigen, en pas dan volgen de punten voor vrijspelen.
--   - Een andere prijs melden kan overal, zoals altijd; de menukaartprijs is dan weerlegd.
--   - Over een menukaartprijs zelf kun je niet oordelen met "klopt" of "klopt niet".

alter table public.gebeurtenissen
  add column bron text not null default 'speler' check (bron in ('speler', 'menukaart')),
  add column bron_omschrijving text check (bron_omschrijving is null or char_length(bron_omschrijving) <= 80),
  add constraint gebeurtenissen_menukaart_zonder_melder check (bron = 'speler' or door_id is null);

comment on column public.gebeurtenissen.bron is 'speler: gemeld door een speler. menukaart: van een menukaart met datum (op), zonder melder.';

-- ---------------------------------------------------------------------------
-- Prijs melden: rekening houden met een openstaande menukaartprijs
-- ---------------------------------------------------------------------------

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
  menu public.gebeurtenissen;
  afstand double precision;
  med numeric;
  per25 numeric;
begin
  if ik is null then
    raise exception 'Log eerst in' using errcode = '28000';
  end if;
  select * into k from public.kroegen where id = p_kroeg_id for update;
  if not found then
    raise exception 'Kroeg bestaat niet' using errcode = 'P0002';
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

  -- Een openstaande menukaartprijs: dezelfde prijs alleen ter plaatse, een andere weerlegt hem.
  select * into menu from public.gebeurtenissen
  where kroeg_id = k.id and status = 'wacht' and bron = 'menukaart'
  for update;
  if found then
    if menu.prijs_cent = p_prijs_cent and menu.volume_cl = p_volume_cl and lower(menu.merk) = lower(trim(p_merk)) then
      if not coalesce(afstand <= 75, false) then
        raise exception 'Een prijs van de menukaart bevestig je ter plaatse: zet je locatie aan bij de kroeg' using errcode = 'P0001';
      end if;
      update public.gebeurtenissen set status = 'bevestigd', afgerond_op = now() where id = menu.id;
    else
      update public.gebeurtenissen set status = 'weerlegd', afgerond_op = now() where id = menu.id;
    end if;
  end if;

  if exists (select 1 from public.gebeurtenissen where kroeg_id = k.id and status = 'wacht') then
    raise exception 'Er staat al een melding open voor deze kroeg; bevestig of weerleg die eerst' using errcode = 'P0001';
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

  return g;
end;
$$;

-- ---------------------------------------------------------------------------
-- Oordelen: niet over een menukaartprijs
-- ---------------------------------------------------------------------------

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
  perform private.vereis_email();
  select * into g from public.gebeurtenissen where id = p_gebeurtenis;
  if not found then
    raise exception 'Melding bestaat niet' using errcode = 'P0002';
  end if;
  if g.bron = 'menukaart' then
    raise exception 'Een prijs van de menukaart bevestig je ter plaatse met "Klopt nog", of meld een andere prijs' using errcode = 'P0001';
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

-- ---------------------------------------------------------------------------
-- Import van menukaartprijzen (alleen service_role)
-- ---------------------------------------------------------------------------

-- p_prijzen: [{ "kroeg_id" of "google_place_id", "merk", "volume_cl", "prijs_cent",
--              "datum" (JJJJ-MM-DD van de kaart), "bron_omschrijving" }]
-- Alleen voor kroegen zonder bevestigde prijs en zonder openstaande melding: een menukaart
-- vult de geschiedenis aan, maar gaat nooit boven wat spelers hebben gemeld.
create or replace function private.importeer_menuprijzen(p_prijzen jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  kid bigint;
  n_toegevoegd integer := 0;
  n_overgeslagen integer := 0;
begin
  if jsonb_typeof(p_prijzen) <> 'array' then
    raise exception 'p_prijzen moet een array zijn';
  end if;
  for r in
    select (x ->> 'kroeg_id')::bigint as kroeg_id,
           x ->> 'google_place_id' as google_place_id,
           trim(x ->> 'merk') as merk,
           (x ->> 'volume_cl')::smallint as volume_cl,
           (x ->> 'prijs_cent')::integer as prijs_cent,
           (x ->> 'datum')::date as datum,
           nullif(trim(x ->> 'bron_omschrijving'), '') as omschrijving
    from jsonb_array_elements(p_prijzen) x
  loop
    select k.id into kid
    from public.kroegen k
    where (k.id = r.kroeg_id or k.google_place_id = r.google_place_id)
      and k.open
      and k.huidig_prijs_cent is null
      and not exists (select 1 from public.gebeurtenissen g where g.kroeg_id = k.id and g.status = 'wacht')
    for update;
    if not found or r.datum is null or r.datum > current_date then
      n_overgeslagen := n_overgeslagen + 1;
      continue;
    end if;
    insert into public.gebeurtenissen (kroeg_id, soort, merk, volume_cl, prijs_cent, door_id, op, bron, bron_omschrijving)
    values (kid, 'eerst', r.merk, r.volume_cl, r.prijs_cent, null, r.datum::timestamptz, 'menukaart', r.omschrijving);
    n_toegevoegd := n_toegevoegd + 1;
  end loop;
  return jsonb_build_object('toegevoegd', n_toegevoegd, 'overgeslagen', n_overgeslagen);
end;
$$;

create or replace function public.importeer_menuprijzen(p_prijzen jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.importeer_menuprijzen(p_prijzen);
$$;

revoke all on function private.importeer_menuprijzen(jsonb), public.importeer_menuprijzen(jsonb) from public, anon, authenticated;
grant execute on function private.importeer_menuprijzen(jsonb), public.importeer_menuprijzen(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Overzichten: de bron erbij (kolommen achteraan, zodat bestaande kolommen gelijk blijven)
-- ---------------------------------------------------------------------------

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
     where b.gebeurtenis_id = g.id and b.oordeel = 'klopt_niet'), '{}') as weerlegd_door,
  g.bron,
  g.bron_omschrijving
from public.gebeurtenissen g
join public.kroegen k on k.id = g.kroeg_id
left join public.profielen p on p.id = g.door_id;

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
  open_melding.id as open_melding_id,
  open_melding.merk as open_merk,
  open_melding.volume_cl as open_volume_cl,
  open_melding.prijs_cent as open_prijs_cent,
  round(open_melding.prijs_cent * 25.0 / open_melding.volume_cl)::integer as open_per25_cent,
  open_melding.op as open_op,
  open_melding.bron as open_bron,
  open_melding.bron_omschrijving as open_bron_omschrijving
from public.kroegen k
left join public.wijken w on w.id = k.wijk_id
left join public.profielen o on o.id = k.ontdekker_id
left join lateral (
  select g.id, g.merk, g.volume_cl, g.prijs_cent, g.op, g.bron, g.bron_omschrijving
  from public.gebeurtenissen g where g.kroeg_id = k.id and g.status = 'wacht' limit 1
) open_melding on true;
