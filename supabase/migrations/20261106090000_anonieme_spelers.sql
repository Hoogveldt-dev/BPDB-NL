-- BPDB-NL: anonieme spelers
-- Nieuwe spelers beginnen meteen, zonder e-mailadres (anonieme accounts van Supabase). Ze mogen prijzen
-- melden, maar die moeten altijd door een speler met e-mailadres worden bevestigd. Bevestigen, weerleggen
-- en "klopt nog" kan alleen met een gekoppeld e-mailadres, zodat niemand met wegwerpaccounts zijn eigen
-- meldingen bevestigt. Een anonieme melder wordt nooit direct bevestigd, ook niet boven 90% betrouwbaarheid.
-- Koppelt een speler later zijn e-mailadres, dan blijft het account met alle punten hetzelfde.

-- Geeft een fout als de vrager een anonieme speler is. Antwoordt alleen over de vrager zelf.
create or replace function private.vereis_email()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from auth.users u where u.id = auth.uid() and u.is_anonymous) then
    raise exception 'Koppel eerst je e-mailadres (tabblad Ik) om meldingen te bevestigen of te controleren'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function private.is_anoniem()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select u.is_anonymous from auth.users u where u.id = auth.uid()), false);
$$;

revoke all on function private.vereis_email(), private.is_anoniem() from public, anon, authenticated;

-- Nieuw profiel: zonder spelersnaam nooit meer een stukje van het e-mailadres als naam, want de naam is openbaar.
create or replace function private.nieuw_profiel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  basis text;
  kandidaat text;
  n integer := 1;
begin
  -- De naam is alleen weergave; autorisatie gebruikt nooit user_metadata.
  basis := coalesce(nullif(trim(new.raw_user_meta_data ->> 'naam'), ''), 'speler');
  basis := left(regexp_replace(basis, '[^[:alnum:] _.-]', '', 'g'), 24);
  if char_length(basis) < 2 then
    basis := 'speler';
  end if;
  kandidaat := basis;
  while exists (select 1 from public.profielen p where lower(p.naam) = lower(kandidaat)) loop
    n := n + 1;
    kandidaat := basis || n::text;
  end loop;
  insert into public.profielen (id, naam) values (new.id, kandidaat);
  return new;
end;
$$;

-- Prijs melden: zoals in de basismigratie, maar een anonieme melder wordt nooit direct bevestigd.
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
  mijn_betrouwbaarheid numeric;
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

  -- Zeer betrouwbare melders met e-mailadres hebben geen tweede bron nodig, behalve bij uitschieters.
  select betrouwbaarheid into mijn_betrouwbaarheid from public.profielen where id = ik;
  if mijn_betrouwbaarheid > 90 and not g.uitschieter and not private.is_anoniem() then
    insert into public.bevestigingen (gebeurtenis_id, door_id, oordeel, gewicht)
    values (g.id, null, 'klopt', 1);
    perform private.rond_af(g.id);
    select * into g from public.gebeurtenissen where id = g.id;
  end if;

  return g;
end;
$$;

-- Beoordelen: zoals in de basismigratie, maar alleen met een gekoppeld e-mailadres.
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

-- "Klopt nog": zoals in de basismigratie, maar alleen met een gekoppeld e-mailadres.
create or replace function private.klopt_nog(
  p_kroeg_id bigint,
  p_lat double precision default null,
  p_lon double precision default null
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
  oud boolean;
  pt integer;
begin
  if ik is null then
    raise exception 'Log eerst in' using errcode = '28000';
  end if;
  perform private.vereis_email();
  select * into k from public.kroegen where id = p_kroeg_id for update;
  if not found then
    raise exception 'Kroeg bestaat niet' using errcode = 'P0002';
  end if;
  if k.huidig_prijs_cent is null then
    raise exception 'Deze kroeg heeft nog geen bevestigde prijs' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.gebeurtenissen where kroeg_id = k.id and status = 'wacht') then
    raise exception 'Er staat een melding open; beoordeel die in plaats van "Klopt nog"' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.gebeurtenissen
             where kroeg_id = k.id and door_id = ik and soort = 'check' and op > now() - interval '7 days') then
    raise exception 'Je hebt deze kroeg deze week al gecontroleerd' using errcode = 'P0001';
  end if;

  if p_lat is not null and p_lon is not null then
    afstand := extensions.st_distance(
      k.locatie,
      extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography);
  end if;
  oud := coalesce(k.laatst_gecontroleerd, k.prijs_sinds) < now() - interval '90 days';

  insert into public.gebeurtenissen (
    kroeg_id, soort, merk, volume_cl, prijs_cent, door_id, ter_plaatse, afstand_m, status, afgerond_op)
  values (
    k.id, 'check', k.huidig_merk, k.huidig_volume_cl, k.huidig_prijs_cent, ik,
    coalesce(afstand <= 75, false), round(afstand), 'bevestigd', now())
  returning * into g;

  update public.kroegen set laatst_gecontroleerd = now() where id = k.id;

  pt := case when oud then 15 else 5 end;
  if g.ter_plaatse then
    pt := round(pt * 1.5);
  end if;
  perform private.geef_punten(ik, case when oud then 'oude_prijs_gecontroleerd' else 'klopt_nog' end, pt, g.id);
  return g;
end;
$$;
