-- Strengere controle op prijzen die flink afwijken (uitschieters).
--
-- Tot nu toe was een prijs een uitschieter als hij meer dan 40% van de mediaan van de stad afweek, maar pas vanaf
-- 5 bevestigde prijzen in de stad. Met weinig bevestigde prijzen (Nijmegen had er 2) stond die regel feitelijk uit.
--
-- Spelregels (op verzoek van de beheerder, 22 november 2026):
--   - De mediaan van de stad telt per open kroeg de bevestigde prijs, of anders een openstaande menukaartprijs, en
--     geldt vanaf 3 prijzen (private.mediaan_per25).
--   - Een prijs is ook een uitschieter als hij ver van de vorige prijs van dezelfde kroeg ligt: meer dan 25% duurder
--     of meer dan 10% goedkoper per 25 cl. Bierprijzen stijgen hooguit een keer per jaar en dalen bijna nooit.
--     De vorige prijs is de bevestigde, anders een openstaande menukaartprijs.
--   - Een uitschieter heeft, net als eerst, altijd twee bevestigingen van anderen nodig.
--   - Punten voor een uitschieter (melden, ter plaatse, foto) komen pas als hij bevestigd is. Wordt hij weerlegd,
--     dan kost dat -20 zoals elke weerlegde melding. Wie "klopt" zegt, krijgt zoals altijd meteen +5.
--   - kroeg_kaart krijgt de kolom open_uitschieter, zodat de app een wachtende uitschieter niet als prijs op de
--     kaart zet (quarantaine), maar alleen bij de kroeg laat zien om te controleren.

create or replace function private.mediaan_per25(p_gemeente text)
returns numeric
language sql
stable
set search_path = ''
as $$
  select case when count(*) >= 3 then percentile_cont(0.5) within group (order by x.p) end
  from (
    select coalesce(k.huidig_prijs_cent * 25.0 / k.huidig_volume_cl,
      (select g.prijs_cent * 25.0 / g.volume_cl from public.gebeurtenissen g
       where g.kroeg_id = k.id and g.status = 'wacht' and g.bron = 'menukaart' limit 1)) as p
    from public.kroegen k
    where k.gemeente = p_gemeente and k.open
  ) x
  where x.p is not null;
$$;

-- Wijkt een prijs per 25 cl flink af van de mediaan van de stad of van de vorige prijs van de kroeg?
create or replace function private.is_uitschieter(p_per25 numeric, p_mediaan numeric, p_vorig numeric)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(abs(p_per25 - p_mediaan) > p_mediaan * 0.4, false)
      or coalesce(p_per25 > p_vorig * 1.25 or p_per25 < p_vorig * 0.9, false);
$$;

-- De punten voor een prijsmelding: eerste prijs +50, wijziging +30, ter plaatse x1,5, foto +5
create or replace function private.geef_meldpunten(g public.gebeurtenissen)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  basis integer;
begin
  if g.bron <> 'speler' or g.door_id is null or g.soort not in ('eerst', 'wijziging') then
    return;
  end if;
  basis := case g.soort when 'eerst' then 50 else 30 end;
  if g.ter_plaatse then
    basis := round(basis * 1.5);
  end if;
  perform private.geef_punten(g.door_id, case g.soort when 'eerst' then 'vrijgespeeld' else 'prijswijziging' end, basis, g.id);
  if g.foto_pad is not null then
    perform private.geef_punten(g.door_id, 'foto', 5, g.id);
  end if;
end;
$$;

-- Meteen punten bij een melding, behalve bij een uitschieter
create or replace function private.punten_bij_melding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'wacht' and not new.uitschieter then
    perform private.geef_meldpunten(new);
  end if;
  return new;
end;
$$;

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

  select betrouwbaarheid into melder_betrouwbaarheid from public.profielen where id = g.door_id;
  nodig := case
    when g.uitschieter then 2
    when coalesce(melder_betrouwbaarheid, 0) > 90 then 1
    else 2
  end;

  -- Weerlegd na twee onafhankelijke 'klopt niet' (of een van een speler boven 90%).
  if tegen >= 2 then
    update public.gebeurtenissen set status = 'weerlegd', afgerond_op = now() where id = g.id;
    -- De punten die de melder en wie "klopt" zei al kregen, gaan er weer af
    delete from public.punten p
    where p.gebeurtenis_id = g.id
      and ((p.gebruiker_id = g.door_id and p.reden in ('vrijgespeeld', 'prijswijziging', 'foto'))
        or (p.reden = 'bevestiging' and p.gebruiker_id in (
              select x.door_id from public.bevestigingen x where x.gebeurtenis_id = g.id and x.oordeel = 'klopt')));
    perform private.geef_punten(g.door_id, 'weerlegd', -20, g.id);
    perform private.pas_betrouwbaarheid_aan(g.door_id, -10);
    for b in select door_id from public.bevestigingen where gebeurtenis_id = g.id and oordeel = 'klopt_niet' loop
      perform private.geef_punten(b.door_id, 'controle', 5, g.id);
      perform private.pas_betrouwbaarheid_aan(b.door_id, 1);
    end loop;
    for b in select door_id from public.bevestigingen where gebeurtenis_id = g.id and oordeel = 'klopt' loop
      perform private.pas_betrouwbaarheid_aan(b.door_id, -3);
    end loop;
    if g.soort = 'eerst' then
      update public.kroegen
      set ontdekker_id = null, ontdekt_op = null
      where id = g.kroeg_id and huidig_prijs_cent is null;
    end if;
    return 'weerlegd';
  end if;

  if voor >= nodig then
    update public.gebeurtenissen set status = 'bevestigd', afgerond_op = now() where id = g.id;
    -- Een uitschieter kreeg bij het melden nog geen punten; die komen nu
    if g.uitschieter then
      perform private.geef_meldpunten(g);
    end if;
    update public.kroegen
    set huidig_merk = g.merk,
        huidig_volume_cl = g.volume_cl,
        huidig_prijs_cent = g.prijs_cent,
        prijs_sinds = g.op,
        laatst_gecontroleerd = greatest(coalesce(laatst_gecontroleerd, g.op), now())
    where id = g.kroeg_id;
    perform private.pas_betrouwbaarheid_aan(g.door_id, 2);
    for b in select door_id from public.bevestigingen where gebeurtenis_id = g.id and oordeel = 'klopt' loop
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

revoke all on function private.rond_af, private.punten_bij_melding, private.geef_meldpunten, private.is_uitschieter,
  private.mediaan_per25 from public, anon, authenticated;

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
  open_m public.gebeurtenissen;
  afstand double precision;
  med numeric;
  per25 numeric;
  vorig numeric;
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

  -- Waarmee we vergelijken, voordat een menukaartprijs hieronder wordt afgerond: de mediaan van de stad en de
  -- vorige prijs van deze kroeg (de bevestigde, anders een openstaande menukaartprijs)
  med := private.mediaan_per25(k.gemeente);
  per25 := p_prijs_cent * 25.0 / p_volume_cl;
  vorig := coalesce(k.huidig_prijs_cent * 25.0 / k.huidig_volume_cl,
    (select x.prijs_cent * 25.0 / x.volume_cl from public.gebeurtenissen x
     where x.kroeg_id = k.id and x.status = 'wacht' and x.bron = 'menukaart' limit 1));

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

  -- Een openstaande melding van een speler: een andere prijs vervangt hem, zonder straf voor de melder
  select * into open_m from public.gebeurtenissen
  where kroeg_id = k.id and status = 'wacht'
  for update;
  if found then
    if open_m.door_id = ik then
      raise exception 'Dit is je eigen melding; een andere speler moet hem bevestigen of weerleggen' using errcode = 'P0001';
    end if;
    if open_m.prijs_cent = p_prijs_cent and open_m.volume_cl = p_volume_cl and lower(open_m.merk) = lower(trim(p_merk)) then
      raise exception 'Deze prijs staat al open; tik op "Klopt"' using errcode = 'P0001';
    end if;
    if private.is_anoniem() then
      raise exception 'Er staat al een melding open voor deze kroeg. Koppel eerst je e-mailadres (tabblad Ik) om een andere prijs door te geven' using errcode = '42501';
    end if;
    if (select count(*) from public.gebeurtenissen x where x.vervangen_door = ik and x.afgerond_op > now() - interval '1 day') >= 5 then
      raise exception 'Je hebt vandaag al 5 meldingen van anderen vervangen. Probeer het morgen weer; is een prijs echt fout, zeg dan "Klopt niet"' using errcode = 'P0001';
    end if;
    update public.gebeurtenissen set status = 'vervangen', afgerond_op = now(), vervangen_door = ik where id = open_m.id;
  end if;

  insert into public.gebeurtenissen (
    kroeg_id, soort, merk, volume_cl, prijs_cent, vorige_prijs_cent, door_id,
    ter_plaatse, afstand_m, foto_pad, uitschieter)
  values (
    k.id,
    case when k.huidig_prijs_cent is null then 'eerst' else 'wijziging' end::public.gebeurtenis_soort,
    trim(p_merk), p_volume_cl, p_prijs_cent, k.huidig_prijs_cent, ik,
    coalesce(afstand <= 75, false), round(afstand), p_foto_pad,
    private.is_uitschieter(per25, med, vorig))
  returning * into g;

  if k.ontdekker_id is null then
    update public.kroegen set ontdekker_id = ik, ontdekt_op = now() where id = k.id;
  end if;

  return g;
end;
$$;

-- Een wachtende uitschieter: de app toont hem niet als prijs op de kaart
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
  open_melding.bron_omschrijving as open_bron_omschrijving,
  coalesce(open_melding.uitschieter, false) as open_uitschieter
from public.kroegen k
left join public.wijken w on w.id = k.wijk_id
left join public.profielen o on o.id = k.ontdekker_id
left join lateral (
  select g.id, g.merk, g.volume_cl, g.prijs_cent, g.op, g.bron, g.bron_omschrijving, g.uitschieter
  from public.gebeurtenissen g where g.kroeg_id = k.id and g.status = 'wacht' limit 1
) open_melding on true;
