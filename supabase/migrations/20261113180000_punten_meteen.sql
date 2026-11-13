-- Punten meteen, en terug als een melding wordt weerlegd.
--
-- Was: punten voor een prijsmelding (en +5 voor wie hem bevestigde) pas als de melding bevestigd was,
-- meestal na twee andere spelers. Met weinig spelers duurde dat lang en bleef de ranglijst leeg.
--
-- Nu:
--   * Wie een prijs meldt, krijgt de punten meteen: eerste prijs +50, wijziging +30, ter plaatse x1,5,
--     foto +5 (trigger op gebeurtenissen).
--   * Wie "klopt" zegt, krijgt meteen +5 (trigger op bevestigingen).
--   * Wordt de melding weerlegd, dan gaan die punten er weer af: bij de melder en bij wie "klopt" zei.
--     Daarbij krijgt de melder, net als eerst, -20, en wie "klopt niet" zei +5.
--   * Wordt de melding bevestigd, dan blijven de punten staan; er komen er geen bij.
-- Bevestigen zelf verandert niet: de prijs komt pas op de kaart na genoeg "klopt", en betrouwbaarheid
-- verandert pas als de melding is afgerond.

create or replace function private.punten_bij_melding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  basis integer;
begin
  if new.bron = 'speler' and new.door_id is not null and new.soort in ('eerst', 'wijziging') and new.status = 'wacht' then
    basis := case new.soort when 'eerst' then 50 else 30 end;
    if new.ter_plaatse then
      basis := round(basis * 1.5);
    end if;
    perform private.geef_punten(new.door_id, case new.soort when 'eerst' then 'vrijgespeeld' else 'prijswijziging' end, basis, new.id);
    if new.foto_pad is not null then
      perform private.geef_punten(new.door_id, 'foto', 5, new.id);
    end if;
  end if;
  return new;
end;
$$;

create trigger punten_bij_melding
  after insert on public.gebeurtenissen
  for each row execute function private.punten_bij_melding();

create or replace function private.punten_bij_bevestiging()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.oordeel = 'klopt' then
    perform private.geef_punten(new.door_id, 'bevestiging', 5, new.gebeurtenis_id);
  end if;
  return new;
end;
$$;

create trigger punten_bij_bevestiging
  after insert on public.bevestigingen
  for each row execute function private.punten_bij_bevestiging();

revoke all on function private.punten_bij_melding, private.punten_bij_bevestiging from public, anon, authenticated;

-- Afronden: geen punten meer bij bevestigen (die zijn er al), wel intrekken bij weerleggen.
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

revoke all on function private.rond_af from public, anon, authenticated;

-- Meldingen die nu al wachten: de punten die er volgens de nieuwe regel al hadden moeten zijn
insert into public.punten (gebruiker_id, reden, punten, gebeurtenis_id)
select g.door_id,
       case g.soort when 'eerst' then 'vrijgespeeld' else 'prijswijziging' end,
       round(case g.soort when 'eerst' then 50 else 30 end * case when g.ter_plaatse then 1.5 else 1 end),
       g.id
from public.gebeurtenissen g
where g.status = 'wacht' and g.bron = 'speler' and g.door_id is not null and g.soort in ('eerst', 'wijziging');

insert into public.punten (gebruiker_id, reden, punten, gebeurtenis_id)
select g.door_id, 'foto', 5, g.id
from public.gebeurtenissen g
where g.status = 'wacht' and g.bron = 'speler' and g.door_id is not null and g.soort in ('eerst', 'wijziging') and g.foto_pad is not null;

insert into public.punten (gebruiker_id, reden, punten, gebeurtenis_id)
select b.door_id, 'bevestiging', 5, g.id
from public.bevestigingen b
join public.gebeurtenissen g on g.id = b.gebeurtenis_id
where g.status = 'wacht' and b.oordeel = 'klopt';
