-- Samenvoegen: een anonieme speler logt in met een bestaand account
-- Wie op een toestel anoniem bijdroeg en daarna inlogt met een account dat hij al had (e-mail, Google of Apple),
-- neemt zijn bijdragen mee: meldingen, oordelen, punten, check-ins, Guinness, kroegmeldingen en ontdekte kroegen
-- gaan over naar het account. Daarna verwijdert de Edge Function samenvoegen de anonieme speler.
--
-- Spelregel: het account mag geen melding van de anonieme speler hebben beoordeeld. Anders heeft dezelfde persoon
-- na het samenvoegen zijn eigen melding bevestigd; zo zou je met wegwerpaccounts punten kunnen verdienen. Dan
-- weigeren we het samenvoegen en blijft de anonieme speler los staan.
-- Dubbele check-ins (zelfde kroeg, zelfde dag) en dubbele oordelen van de anonieme speler vervallen.
-- De betrouwbaarheid van het account blijft zoals hij was.
--
-- Alleen aan te roepen met de service_role (door de Edge Function, die eerst controleert dat de speler beide
-- accounts bezit).

create or replace function private.voeg_samen(p_van uuid, p_naar uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_meldingen integer;
  n_punten integer;
  n_check integer;
begin
  if p_van is null or p_naar is null or p_van = p_naar then
    raise exception 'Dit is hetzelfde account' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_van and u.is_anonymous) then
    raise exception 'Alleen een anonieme speler kan worden samengevoegd' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_naar and not u.is_anonymous) then
    raise exception 'Samenvoegen kan alleen met een account' using errcode = '42501';
  end if;

  -- Niet je eigen werk bevestigen
  if exists (select 1 from public.bevestigingen b join public.gebeurtenissen g on g.id = b.gebeurtenis_id
             where b.door_id = p_naar and g.door_id = p_van)
     or exists (select 1 from public.aanbod_oordelen o join public.kroeg_aanbod a on a.id = o.aanbod_id
                where o.door_id = p_naar and a.door_id = p_van)
     or exists (select 1 from public.kroegmelding_oordelen o join public.kroeg_meldingen m on m.id = o.melding_id
                where o.door_id = p_naar and m.door_id = p_van) then
    raise exception 'Samenvoegen kan niet: met dit account heb je een melding van je anonieme speler beoordeeld'
      using errcode = 'P0001';
  end if;

  -- Wat het account al heeft, wint: dubbele check-ins en oordelen van de anonieme speler vervallen
  delete from public.incheckingen i where i.gebruiker_id = p_van
    and exists (select 1 from public.incheckingen j where j.gebruiker_id = p_naar and j.kroeg_id = i.kroeg_id and j.dag = i.dag);
  delete from public.bevestigingen b where b.door_id = p_van
    and exists (select 1 from public.bevestigingen c where c.door_id = p_naar and c.gebeurtenis_id = b.gebeurtenis_id);
  delete from public.aanbod_oordelen o where o.door_id = p_van
    and exists (select 1 from public.aanbod_oordelen p where p.door_id = p_naar and p.aanbod_id = o.aanbod_id);
  delete from public.kroegmelding_oordelen o where o.door_id = p_van
    and exists (select 1 from public.kroegmelding_oordelen p where p.door_id = p_naar and p.melding_id = o.melding_id);

  update public.gebeurtenissen set door_id = p_naar where door_id = p_van;
  get diagnostics n_meldingen = row_count;
  update public.punten set gebruiker_id = p_naar where gebruiker_id = p_van;
  get diagnostics n_punten = row_count;
  update public.incheckingen set gebruiker_id = p_naar where gebruiker_id = p_van;
  get diagnostics n_check = row_count;
  update public.bevestigingen set door_id = p_naar where door_id = p_van;
  update public.kroeg_aanbod set door_id = p_naar where door_id = p_van;
  update public.aanbod_oordelen set door_id = p_naar where door_id = p_van;
  update public.kroeg_meldingen set door_id = p_naar where door_id = p_van;
  update public.kroegmelding_oordelen set door_id = p_naar where door_id = p_van;
  update public.app_teksten set door_id = p_naar where door_id = p_van;
  update public.kroegen set ontdekker_id = p_naar where ontdekker_id = p_van;

  return jsonb_build_object('meldingen', n_meldingen, 'punten', n_punten, 'checkins', n_check);
end;
$$;

create or replace function public.voeg_samen(p_van uuid, p_naar uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.voeg_samen(p_van, p_naar);
$$;

revoke all on function public.voeg_samen(uuid, uuid) from public, anon, authenticated;
revoke all on function private.voeg_samen(uuid, uuid) from public, anon, authenticated;
grant execute on function public.voeg_samen(uuid, uuid) to service_role;
grant execute on function private.voeg_samen(uuid, uuid) to service_role;
