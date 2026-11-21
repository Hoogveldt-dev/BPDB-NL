-- Een nieuwe prijs naast een openstaande melding, zonder "klopt niet".
--
-- Tot nu toe weigerde meld_prijs een prijs zolang er een melding van een speler openstond. Wie wist dat de prijs
-- was gestegen, kon alleen "klopt niet" zeggen: twee keer en de melder kreeg -20 punten en -10% betrouwbaarheid,
-- terwijl zijn prijs destijds gewoon klopte. Nu vervangt een andere prijs de openstaande melding: die krijgt de
-- status 'vervangen'. De melder houdt zijn punten en zijn betrouwbaarheid blijft gelijk, en wie "klopt" zei ook.
-- "Klopt niet" blijft voor een prijs die overduidelijk fout is.
--
-- Spelregels:
--   - Alleen een speler met e-mailadres vervangt de melding van een ander (vervangen is een soort weerleggen).
--     Is er geen melding open, dan meldt een anonieme speler gewoon een prijs, zoals voorheen.
--   - Een eigen melding vervang je niet: een andere speler moet hem bevestigen of weerleggen.
--   - Dezelfde prijs als de openstaande melding is geen nieuwe melding; daar is "klopt" voor.
--   - De nieuwe melding wacht zoals altijd op bevestiging door andere spelers.
--   - Hoogstens 5 vervangingen per speler per dag (vervangen_door). Zonder die grens konden twee accounts elkaars
--     melding steeds vervangen en zo punten pakken; vervangen is de makkelijkste weg naar punten, want er is geen
--     derde speler voor nodig.
--
-- Een nieuwe enum-waarde mag in dezelfde transactie nog niet in SQL worden gebruikt; de functie hieronder
-- verwijst er pas bij het uitvoeren naar. Views veranderen niet: ze kijken naar 'bevestigd' of 'wacht'.

alter type public.gebeurtenis_status add value if not exists 'vervangen';

-- Wie een melding verving, voor de daglimiet en om na te kijken wat er gebeurde
alter table public.gebeurtenissen add column vervangen_door uuid references public.profielen (id) on delete set null;
create index gebeurtenissen_vervangen_door_idx on public.gebeurtenissen (vervangen_door, afgerond_op desc) where vervangen_door is not null;

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
