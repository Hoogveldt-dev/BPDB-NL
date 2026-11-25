-- Een kroeg die ontbreekt: spelers stellen hem voor, de beheerder keurt goed.
--
-- Een speler zet een speld op de kaart, geeft de naam en eventueel een toelichting (stel_kroeg_voor). Ook anonieme
-- spelers mogen dat: de beheerder kijkt elk voorstel na. Geen punten voor het voorstel zelf; de kroeg begint zonder
-- prijs, dus wie hem daarna als eerste een prijs geeft, brengt hem gewoon in kaart (+50).
--
-- Keurt de beheerder het voorstel goed (zet_kroegvoorstel), dan komt er een kroeg zonder osm_id bij, in de gemeente
-- van het voorstel en gekoppeld aan zijn wijk. De OSM-import sluit alleen kroegen met een osm_id, dus de kroeg blijft
-- staan. Komt dezelfde kroeg later in OpenStreetMap, dan koppelt importeer_kroegen hem aan de bestaande kroeg in
-- plaats van een tweede kroeg te maken: met dezelfde regel als de Google-koppeling (20261106180000_google_koppeling),
-- een gelijkende naam van ten minste 0,35 binnen 75 m, of 0,15 binnen 25 m. Daarna volgt de kroeg OSM.
--
-- Alleen beheerders lezen de voorstellen; schrijven gaat alleen via de functies.

create table public.kroeg_voorstellen (
  id bigint generated always as identity primary key,
  door_id uuid references public.profielen (id) on delete set null,
  naam text not null check (char_length(naam) between 2 and 80),
  toelichting text check (toelichting is null or char_length(toelichting) between 2 and 280),
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  gemeente text not null,
  status text not null default 'open' check (status in ('open', 'goedgekeurd', 'afgewezen')),
  kroeg_id bigint references public.kroegen (id) on delete set null,
  op timestamptz not null default now(),
  behandeld_op timestamptz,
  gemaild_op timestamptz
);
create index kroeg_voorstellen_door_idx on public.kroeg_voorstellen (door_id);
create index kroeg_voorstellen_kroeg_idx on public.kroeg_voorstellen (kroeg_id);
create index kroeg_voorstellen_open_idx on public.kroeg_voorstellen (status) where status = 'open';
comment on table public.kroeg_voorstellen is 'Kroegen die volgens spelers ontbreken. Alleen beheerders lezen ze; schrijven alleen via stel_kroeg_voor en zet_kroegvoorstel.';

alter table public.kroeg_voorstellen enable row level security;
revoke all on public.kroeg_voorstellen from anon, authenticated;
grant select on public.kroeg_voorstellen to authenticated;
create policy "beheerders lezen kroegvoorstellen" on public.kroeg_voorstellen
  for select to authenticated
  using (exists (select 1 from public.profielen p where p.id = (select auth.uid()) and p.is_beheerder));

-- Een kroeg voorstellen. Geeft het id van het voorstel terug (voor de mail aan de beheerder).
create or replace function private.stel_kroeg_voor(p_naam text, p_lat double precision, p_lon double precision, p_toelichting text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  ik uuid := auth.uid();
  v_naam text := regexp_replace(trim(coalesce(p_naam, '')), '\s+', ' ', 'g');
  v_toelichting text := nullif(regexp_replace(trim(coalesce(p_toelichting, '')), '\s+', ' ', 'g'), '');
  punt extensions.geography;
  v_gemeente text;
  bestaand text;
  nieuw bigint;
begin
  if ik is null then
    raise exception 'Log eerst in' using errcode = '28000';
  end if;
  if char_length(v_naam) < 2 or char_length(v_naam) > 80 then
    raise exception 'Vul de naam van de kroeg in' using errcode = 'P0001';
  end if;
  if v_toelichting is not null and (char_length(v_toelichting) < 2 or char_length(v_toelichting) > 280) then
    raise exception 'Maak de toelichting korter dan 280 tekens' using errcode = 'P0001';
  end if;
  if p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180 then
    raise exception 'Zet de speld op de plek van de kroeg' using errcode = 'P0001';
  end if;
  punt := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography;

  -- De gemeente: de wijk waar de speld in staat, anders de gemeente van de dichtstbijzijnde kroeg binnen 3 km
  select w.gemeente into v_gemeente from public.wijken w where extensions.st_covers(w.geometrie, punt) limit 1;
  if v_gemeente is null then
    select k.gemeente into v_gemeente from public.kroegen k
     where extensions.st_dwithin(k.locatie, punt, 3000)
     order by extensions.st_distance(k.locatie, punt) limit 1;
  end if;
  if v_gemeente is null then
    raise exception 'Deze plek ligt niet in een stad die meedoet. Vraag de stad aan onder Ik.' using errcode = 'P0001';
  end if;

  -- Staat hij er al? Een open kroeg of een open voorstel met een gelijkende naam vlakbij.
  select k.naam into bestaand from public.kroegen k
   where k.open and extensions.st_dwithin(k.locatie, punt, 75)
     and extensions.similarity(private.kroegnaam_kern(k.naam, v_gemeente), private.kroegnaam_kern(v_naam, v_gemeente)) >= 0.35
   limit 1;
  if bestaand is not null then
    raise exception '% staat al op de kaart', bestaand using errcode = 'P0001';
  end if;
  if exists (select 1 from public.kroeg_voorstellen v
              where v.status = 'open'
                and extensions.st_dwithin(extensions.st_setsrid(extensions.st_makepoint(v.lon, v.lat), 4326)::extensions.geography, punt, 75)
                and extensions.similarity(private.kroegnaam_kern(v.naam, v_gemeente), private.kroegnaam_kern(v_naam, v_gemeente)) >= 0.35) then
    raise exception 'Deze kroeg is al voorgesteld en wacht op de beheerder' using errcode = 'P0001';
  end if;
  if (select count(*) from public.kroeg_voorstellen v where v.door_id = ik and v.status = 'open') >= 5 then
    raise exception 'Je hebt al 5 kroegen voorgesteld die nog wachten. Probeer het later weer.' using errcode = 'P0001';
  end if;

  insert into public.kroeg_voorstellen (door_id, naam, toelichting, lat, lon, gemeente)
  values (ik, v_naam, v_toelichting, p_lat, p_lon, v_gemeente)
  returning id into nieuw;
  return nieuw;
end;
$$;

revoke all on function private.stel_kroeg_voor(text, double precision, double precision, text) from public, anon, authenticated;
grant execute on function private.stel_kroeg_voor(text, double precision, double precision, text) to authenticated;

create or replace function public.stel_kroeg_voor(p_naam text, p_lat double precision, p_lon double precision, p_toelichting text default null)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.stel_kroeg_voor(p_naam, p_lat, p_lon, p_toelichting);
$$;

revoke all on function public.stel_kroeg_voor(text, double precision, double precision, text) from public, anon, authenticated;
grant execute on function public.stel_kroeg_voor(text, double precision, double precision, text) to authenticated;

-- Beheerder: een voorstel goedkeuren (de kroeg komt op de kaart) of afwijzen. Geeft bij goedkeuren het id van de
-- nieuwe kroeg terug, anders null.
create or replace function private.zet_kroegvoorstel(p_id bigint, p_status text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  ik uuid := auth.uid();
  v public.kroeg_voorstellen;
  nieuw bigint;
begin
  if ik is null or not exists (select 1 from public.profielen where id = ik and is_beheerder) then
    raise exception 'Alleen voor beheerders' using errcode = '42501';
  end if;
  if p_status not in ('goedgekeurd', 'afgewezen') then
    raise exception 'Onbekende status' using errcode = 'P0001';
  end if;
  select * into v from public.kroeg_voorstellen where id = p_id for update;
  if v.id is null then
    raise exception 'Dit voorstel bestaat niet' using errcode = 'P0001';
  end if;
  if v.status <> 'open' then
    raise exception 'Dit voorstel is al afgehandeld' using errcode = 'P0001';
  end if;
  if p_status = 'goedgekeurd' then
    insert into public.kroegen (naam, gemeente, locatie)
    values (v.naam, v.gemeente, extensions.st_setsrid(extensions.st_makepoint(v.lon, v.lat), 4326)::extensions.geography)
    returning id into nieuw;
    perform private.koppel_wijken();
  end if;
  update public.kroeg_voorstellen set status = p_status, behandeld_op = now(), kroeg_id = nieuw where id = v.id;
  return nieuw;
end;
$$;

revoke all on function private.zet_kroegvoorstel(bigint, text) from public, anon, authenticated;
grant execute on function private.zet_kroegvoorstel(bigint, text) to authenticated;

create or replace function public.zet_kroegvoorstel(p_id bigint, p_status text)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.zet_kroegvoorstel(p_id, p_status);
$$;

revoke all on function public.zet_kroegvoorstel(bigint, text) from public, anon, authenticated;
grant execute on function public.zet_kroegvoorstel(bigint, text) to authenticated;

-- De OSM-import, zoals in 20261106190000_kroeg_meldingen, plus: een kroeg die spelers toevoegden, krijgt het osm_id
-- van dezelfde kroeg in OSM, zodat er geen tweede kroeg bij komt. Alle paren worden in een keer verdeeld, beste naam
-- eerst, zoals bij de Google-koppeling.
create or replace function private.importeer_kroegen(p_kroegen jsonb, p_gemeente text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  aantal integer;
  p record;
begin
  for p in
    select o.osm_id, k.id as kroeg_id
    from (select r ->> 'osm_id' as osm_id, r ->> 'naam' as naam,
                 extensions.st_setsrid(extensions.st_makepoint((r ->> 'lon')::double precision, (r ->> 'lat')::double precision), 4326)::extensions.geography as locatie
          from jsonb_array_elements(p_kroegen) r
          where coalesce(r ->> 'naam', '') <> '' and coalesce(r ->> 'osm_id', '') <> '') o
    join public.kroegen k
      on k.gemeente = p_gemeente
     and k.osm_id is null
     and exists (select 1 from public.kroeg_voorstellen v where v.kroeg_id = k.id)
     and extensions.st_dwithin(k.locatie, o.locatie, 75)
    cross join lateral (
      select extensions.st_distance(k.locatie, o.locatie) as afstand,
             extensions.similarity(private.kroegnaam_kern(k.naam, p_gemeente), private.kroegnaam_kern(o.naam, p_gemeente)) as gelijk
    ) m
    where not exists (select 1 from public.kroegen x where x.osm_id = o.osm_id)
      and (m.gelijk >= 0.35 or (m.gelijk >= 0.15 and m.afstand <= 25))
    order by m.gelijk desc, m.afstand
  loop
    update public.kroegen k set osm_id = p.osm_id
     where k.id = p.kroeg_id and k.osm_id is null
       and not exists (select 1 from public.kroegen x where x.osm_id = p.osm_id);
  end loop;

  with rij as (
    select r ->> 'osm_id' as osm_id,
           r ->> 'naam' as naam,
           r ->> 'soort' as soort,
           r ->> 'adres' as adres,
           (r ->> 'lat')::double precision as lat,
           (r ->> 'lon')::double precision as lon
    from jsonb_array_elements(p_kroegen) r
    where coalesce(r ->> 'naam', '') <> ''
  ), upsert as (
    insert into public.kroegen (osm_id, naam, soort, adres, gemeente, locatie)
    select osm_id, naam, soort, adres, p_gemeente,
           extensions.st_setsrid(extensions.st_makepoint(lon, lat), 4326)::extensions.geography
    from rij
    on conflict (osm_id) do update
      set naam = excluded.naam,
          soort = excluded.soort,
          adres = coalesce(excluded.adres, public.kroegen.adres),
          locatie = excluded.locatie,
          open = not public.kroegen.gesloten_door_spelers
    returning 1
  )
  select count(*) into aantal from upsert;

  -- Kroegen die niet meer in OSM staan sluiten (niet verwijderen: de geschiedenis blijft).
  update public.kroegen
  set open = false
  where gemeente = p_gemeente and osm_id is not null
    and osm_id not in (select r ->> 'osm_id' from jsonb_array_elements(p_kroegen) r);

  perform private.koppel_wijken();
  return aantal;
end;
$$;

revoke all on function private.importeer_kroegen(jsonb, text) from public, anon, authenticated;
grant execute on function private.importeer_kroegen(jsonb, text) to service_role;

-- De mail aan de beheerder: claim_melding_mail, zoals in 20261122200000_inbox, kent nu ook de soort "kroeg".
create or replace function private.claim_melding_mail(p_soort text, p_id bigint, p_door uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
begin
  if p_soort = 'bug' then
    update public.bugmeldingen b
       set gemaild_op = now()
     where b.id = p_id and b.door_id = p_door and b.gemaild_op is null and b.op > now() - interval '10 minutes'
    returning jsonb_build_object(
      'soort', 'bug', 'tekst', b.tekst, 'scherm', b.scherm, 'apparaat', b.apparaat, 'op', b.op,
      'naam', (select p.naam from public.profielen p where p.id = b.door_id)
    ) into r;
  elsif p_soort = 'stad' then
    update public.stadsaanvragen s
       set gemaild_op = now()
     where s.id = p_id and s.door_id = p_door and s.gemaild_op is null and s.op > now() - interval '10 minutes'
    returning jsonb_build_object(
      'soort', 'stad', 'stad', s.stad, 'op', s.op,
      'naam', (select p.naam from public.profielen p where p.id = s.door_id),
      'spelers', (select count(*)::int from public.stadsaanvragen o where o.stad_sleutel = s.stad_sleutel and o.status = 'open')
    ) into r;
  elsif p_soort = 'antwoord' then
    update public.bericht_antwoorden a
       set gemaild_op = now()
     where a.id = p_id and a.door_id = p_door and a.gemaild_op is null and a.op > now() - interval '10 minutes'
    returning jsonb_build_object(
      'soort', 'antwoord', 'tekst', a.tekst, 'op', a.op, 'van_beheer', a.van_beheer,
      'naam', (select p.naam from public.profielen p where p.id = a.door_id),
      'bericht', (select b.tekst from public.bugmeldingen b where b.id = a.bericht_id),
      'speler', (select b.door_id from public.bugmeldingen b where b.id = a.bericht_id)
    ) into r;
  elsif p_soort = 'kroeg' then
    update public.kroeg_voorstellen v
       set gemaild_op = now()
     where v.id = p_id and v.door_id = p_door and v.gemaild_op is null and v.op > now() - interval '10 minutes'
    returning jsonb_build_object(
      'soort', 'kroeg', 'kroeg', v.naam, 'gemeente', v.gemeente, 'toelichting', v.toelichting,
      'lat', v.lat, 'lon', v.lon, 'op', v.op,
      'naam', (select p.naam from public.profielen p where p.id = v.door_id)
    ) into r;
  else
    raise exception 'Onbekende soort melding' using errcode = 'P0001';
  end if;
  return r; -- null: al gemaild, niet van deze speler, of te oud
end;
$$;

revoke all on function private.claim_melding_mail(text, bigint, uuid) from public, anon, authenticated;
grant execute on function private.claim_melding_mail(text, bigint, uuid) to service_role;

-- Nieuwe voorstellen meteen zien onder Beheer (realtime volgt de leesregel hierboven)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.kroeg_voorstellen;
  end if;
end;
$$;
