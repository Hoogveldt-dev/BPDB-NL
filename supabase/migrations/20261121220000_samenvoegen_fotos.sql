-- Samenvoegen: ook foto's van de kaart, bugmeldingen en stadsaanvragen gaan mee
-- Een anonieme speler die inlogt met een bestaand account, neemt zijn bijdragen mee (zie 20261110130000_samenvoegen).
-- Sinds die migratie zijn er drie tabellen bijgekomen met een speler erin. Die bleven achter: na het samenvoegen
-- verwijdert de Edge Function samenvoegen de anonieme speler, en dan werd door_id leeg (on delete set null).
--   - kroeg_fotos: de foto verloor zijn naam, en de speler kon zijn eigen foto niet meer verwijderen
--     (verwijder_foto controleert door_id), terwijl de punten wel meegingen.
--   - bugmeldingen en stadsaanvragen: de melding verloor wie hem deed. Een stadsaanvraag telt per speler mee.
--   Het bestand blijft in de map van de anonieme speler in de opslag staan (de speler kan het daar niet wissen),
--   maar verwijder_foto haalt de foto wel voor iedereen uit de app.
-- gebeurtenissen.vervangen_door hoeft niet mee: een anonieme speler kan geen melding vervangen (private.meld_prijs).
--
-- Spelregel (onveranderd, 20261121200000_kaartfotos_punten_verwijderen): hoogstens 5 punten per kroeg per speler
-- voor een foto van de kaart. Had het account al een foto bij dezelfde kroeg (ook een verwijderde), dan levert de
-- foto van de anonieme speler na het samenvoegen geen punten meer op. Een dubbele stadsaanvraag vervalt.

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
  n_fotos integer;
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

  -- Wat het account al heeft, wint: dubbele check-ins, oordelen en stadsaanvragen van de anonieme speler vervallen
  delete from public.incheckingen i where i.gebruiker_id = p_van
    and exists (select 1 from public.incheckingen j where j.gebruiker_id = p_naar and j.kroeg_id = i.kroeg_id and j.dag = i.dag);
  delete from public.bevestigingen b where b.door_id = p_van
    and exists (select 1 from public.bevestigingen c where c.door_id = p_naar and c.gebeurtenis_id = b.gebeurtenis_id);
  delete from public.aanbod_oordelen o where o.door_id = p_van
    and exists (select 1 from public.aanbod_oordelen p where p.door_id = p_naar and p.aanbod_id = o.aanbod_id);
  delete from public.kroegmelding_oordelen o where o.door_id = p_van
    and exists (select 1 from public.kroegmelding_oordelen p where p.door_id = p_naar and p.melding_id = o.melding_id);
  delete from public.stadsaanvragen s where s.door_id = p_van
    and exists (select 1 from public.stadsaanvragen t where t.door_id = p_naar and t.stad_sleutel = s.stad_sleutel);

  -- Hoogstens 5 punten per kroeg per speler voor een foto van de kaart: had het account al een foto bij die kroeg,
  -- dan vervallen de punten van de foto van de anonieme speler daar
  delete from public.punten pt using public.kroeg_fotos f
    where pt.kaartfoto_id = f.id and f.door_id = p_van
      and exists (select 1 from public.kroeg_fotos g where g.door_id = p_naar and g.kroeg_id = f.kroeg_id);
  update public.kroeg_fotos f set punten = 0
    where f.door_id = p_van and f.punten > 0
      and exists (select 1 from public.kroeg_fotos g where g.door_id = p_naar and g.kroeg_id = f.kroeg_id);

  update public.gebeurtenissen set door_id = p_naar where door_id = p_van;
  get diagnostics n_meldingen = row_count;
  update public.punten set gebruiker_id = p_naar where gebruiker_id = p_van;
  get diagnostics n_punten = row_count;
  update public.incheckingen set gebruiker_id = p_naar where gebruiker_id = p_van;
  get diagnostics n_check = row_count;
  update public.kroeg_fotos set door_id = p_naar where door_id = p_van;
  get diagnostics n_fotos = row_count;
  update public.bevestigingen set door_id = p_naar where door_id = p_van;
  update public.kroeg_aanbod set door_id = p_naar where door_id = p_van;
  update public.aanbod_oordelen set door_id = p_naar where door_id = p_van;
  update public.kroeg_meldingen set door_id = p_naar where door_id = p_van;
  update public.kroegmelding_oordelen set door_id = p_naar where door_id = p_van;
  update public.app_teksten set door_id = p_naar where door_id = p_van;
  update public.bugmeldingen set door_id = p_naar where door_id = p_van;
  update public.stadsaanvragen set door_id = p_naar where door_id = p_van;
  update public.kroegen set ontdekker_id = p_naar where ontdekker_id = p_van;

  return jsonb_build_object('meldingen', n_meldingen, 'punten', n_punten, 'checkins', n_check, 'fotos', n_fotos);
end;
$$;

-- Rechten zoals in 20261110130000_samenvoegen: alleen de service_role (de Edge Function samenvoegen)
revoke all on function private.voeg_samen(uuid, uuid) from public, anon, authenticated;
grant execute on function private.voeg_samen(uuid, uuid) to service_role;
