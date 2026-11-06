-- BPDB-NL: bevestigen hangt af van de betrouwbaarheid van de melder, en een nog niet
-- bevestigde prijs wordt getoond naast de vorige bevestigde.
--
-- Spelregel (was: melder boven 90% werd direct bevestigd, anderen hadden een ander nodig):
--   * Melder boven 90%: een andere speler moet de melding bevestigen.
--   * Alle andere melders: twee andere spelers (of een speler boven 90%, die telt dubbel).
--   * Uitschieters: altijd twee andere spelers.
-- Niemand wordt meer bevestigd zonder dat een andere speler ernaar gekeken heeft. Daardoor
-- ontstaat ook geen bevestiging zonder speler (door_id null) meer.
--
-- Het spel (vrijspelen, punten, ranglijst, versheid, mediaan) draait nog steeds alleen om
-- de laatst bevestigde prijs. kroeg_kaart krijgt er alleen kolommen bij voor de melding die
-- wacht, zodat de app die als meest recente prijs kan tonen met de bevestigde ernaast.

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
  melder_betrouwbaarheid numeric;
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

  -- Een melder boven 90% heeft een ander nodig (twee bronnen), iedereen anders twee anderen
  -- (drie bronnen). Uitschieters hebben altijd twee anderen nodig. Een oordeel van een speler
  -- boven 90% telt dubbel (zie private.beoordeel), behalve bij uitschieters.
  select betrouwbaarheid into melder_betrouwbaarheid from public.profielen where id = g.door_id;
  nodig := case
    when g.uitschieter then 2
    when coalesce(melder_betrouwbaarheid, 0) > 90 then 1
    else 2
  end;

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

-- Prijs melden: niemand wordt meer direct bevestigd; een ander moet er altijd naar kijken.
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

  return g;
end;
$$;

-- Overzicht voor de kaart: zoals voorheen, plus de melding die nog op bevestiging wacht.
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
  open_melding.op as open_op
from public.kroegen k
left join public.wijken w on w.id = k.wijk_id
left join public.profielen o on o.id = k.ontdekker_id
left join lateral (
  select g.id, g.merk, g.volume_cl, g.prijs_cent, g.op
  from public.gebeurtenissen g where g.kroeg_id = k.id and g.status = 'wacht' limit 1
) open_melding on true;
