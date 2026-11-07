-- Klopt deze kroeg niet? Naast openingstijden en een sluiting melden spelers nu ook:
--
--   verkeerde_plek  De kroeg staat op de verkeerde plek op de kaart. Een andere speler met
--                   e-mailadres kan het bevestigen; daarna verplaatst een beheerder hem.
--                   Er gebeurt niets vanzelf, want de app weet niet waar hij wel hoort.
--   dubbel          Dezelfde kroeg staat twee keer op de kaart. Je meldt het bij de kroeg
--                   die weg moet. Na "klopt" van een andere speler met e-mailadres
--                   verdwijnt die van de kaart, net als bij een sluiting, en de imports
--                   zetten hem niet terug.
--
-- Bij deze twee soorten hoort een korte toelichting (optioneel, hoogstens 280 tekens),
-- bijvoorbeeld "zit aan de overkant" of "zelfde als Café De Fuik". Dezelfde regels als bij
-- de andere meldingen: geen punten, anonieme spelers mogen melden maar niet oordelen,
-- per kroeg per soort hoogstens een melding open, en alleen via meld_kroeg.

alter type public.kroegmelding_soort add value if not exists 'verkeerde_plek';
alter type public.kroegmelding_soort add value if not exists 'dubbel';

alter table public.kroeg_meldingen
  add column toelichting text check (toelichting is null or char_length(toelichting) between 2 and 280);
comment on column public.kroeg_meldingen.toelichting is 'Korte uitleg bij verkeerde_plek, dubbel of gesloten; zichtbaar voor iedereen.';

-- Nieuwe parameter p_toelichting. Eerst de oude versie weg, anders zijn er twee met dezelfde naam.
drop function public.meld_kroeg(bigint, public.kroegmelding_soort, jsonb);
drop function private.meld_kroeg(bigint, public.kroegmelding_soort, jsonb);

create function private.meld_kroeg(
  p_kroeg_id bigint,
  p_soort public.kroegmelding_soort,
  p_openingstijden jsonb default null,
  p_toelichting text default null
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
  uitleg text := nullif(trim(coalesce(p_toelichting, '')), '');
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
  if uitleg is not null and char_length(uitleg) > 280 then
    raise exception 'Houd de toelichting kort: hoogstens 280 tekens' using errcode = 'P0001';
  end if;

  if p_soort = 'openingstijden' then
    if p_openingstijden is null or not private.geldige_openingstijden(p_openingstijden) then
      raise exception 'Vul voor elke dag tijden in als 16:00-02:00, of laat de dag leeg als hij dicht is' using errcode = 'P0001';
    end if;
    if p_openingstijden = k.openingstijden then
      raise exception 'Dit zijn de tijden die er al staan' using errcode = 'P0001';
    end if;
    if uitleg is not null then
      raise exception 'Bij openingstijden hoort geen toelichting' using errcode = 'P0001';
    end if;
    insert into public.kroeg_meldingen (kroeg_id, soort, openingstijden, vorige_openingstijden, vorige_bron, door_id)
    values (k.id, 'openingstijden', p_openingstijden, k.openingstijden, k.openingstijden_bron, ik)
    returning * into m;
    update public.kroegen
    set openingstijden = p_openingstijden, openingstijden_bron = 'spelers', openingstijden_op = now()
    where id = k.id;
  else
    if p_openingstijden is not null then
      raise exception 'Bij deze melding horen geen openingstijden' using errcode = 'P0001';
    end if;
    insert into public.kroeg_meldingen (kroeg_id, soort, door_id, toelichting)
    values (k.id, p_soort, ik, uitleg)
    returning * into m;
  end if;
  return m;
end;
$$;

-- Zelfde als in 20261106190000_kroeg_meldingen.sql, plus: een bevestigde dubbele kroeg verdwijnt van de kaart.
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

  if m.soort::text in ('gesloten', 'dubbel') and nieuw = 'bevestigd' then
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

create function public.meld_kroeg(
  p_kroeg_id bigint,
  p_soort public.kroegmelding_soort,
  p_openingstijden jsonb default null,
  p_toelichting text default null
)
returns public.kroeg_meldingen
language sql
security invoker
set search_path = ''
as $$
  select * from private.meld_kroeg(p_kroeg_id, p_soort, p_openingstijden, p_toelichting);
$$;

revoke all on function public.meld_kroeg from public, anon, authenticated;
grant execute on function public.meld_kroeg to authenticated;
grant execute on function private.meld_kroeg, private.beoordeel_kroegmelding to authenticated;

-- Het overzicht geeft nu ook de toelichting mee
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
            'toelichting', m.toelichting,
            'klopt_niet', (select count(*) from public.kroegmelding_oordelen o where o.melding_id = m.id and o.oordeel = 'klopt_niet'))
          order by m.op)
   from public.kroeg_meldingen m
   left join public.profielen p on p.id = m.door_id
   where m.kroeg_id = k.id and m.status = 'wacht') as open_meldingen
from public.kroegen k;

grant select on public.kroeg_info to anon, authenticated;
