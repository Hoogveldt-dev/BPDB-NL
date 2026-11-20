-- Een nieuwe stad aanvragen (tabblad Ik).
--
-- Elke speler, ook een anonieme, vraagt een stad aan. Dezelfde stad door meer spelers aangevraagd telt als
-- meer vraag: de beheerder ziet per stad hoeveel spelers erom vroegen. Keurt de beheerder een stad goed, dan
-- importeert de app de kroegen met de Edge Function osm-import en zet daarna de status op goedgekeurd
-- (zet_stadsaanvraag). Alleen beheerders lezen de aanvragen; schrijven gaat alleen via de functies.

create table public.stadsaanvragen (
  id bigint generated always as identity primary key,
  door_id uuid references public.profielen (id) on delete set null,
  stad text not null check (char_length(stad) between 2 and 60 and stad ~ '^[[:alpha:] .''-]+$'),
  stad_sleutel text generated always as (lower(trim(stad))) stored,
  status text not null default 'open' check (status in ('open', 'goedgekeurd', 'afgewezen')),
  op timestamptz not null default now(),
  behandeld_op timestamptz,
  unique (door_id, stad_sleutel)
);
create index stadsaanvragen_sleutel_idx on public.stadsaanvragen (stad_sleutel);
comment on table public.stadsaanvragen is 'Steden die spelers willen vrijspelen. Alleen beheerders lezen ze; schrijven alleen via vraag_stad_aan en zet_stadsaanvraag.';

alter table public.stadsaanvragen enable row level security;
revoke all on public.stadsaanvragen from anon, authenticated;
grant select on public.stadsaanvragen to authenticated;
create policy "beheerders lezen stadsaanvragen" on public.stadsaanvragen
  for select to authenticated
  using (exists (select 1 from public.profielen p where p.id = (select auth.uid()) and p.is_beheerder));

create or replace function private.vraag_stad_aan(p_stad text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  ik uuid := auth.uid();
  v_stad text := regexp_replace(trim(coalesce(p_stad, '')), '\s+', ' ', 'g');
  nieuw bigint;
begin
  if ik is null then
    raise exception 'Log eerst in' using errcode = '28000';
  end if;
  if char_length(v_stad) < 2 or char_length(v_stad) > 60 or v_stad !~ '^[[:alpha:] .''-]+$' then
    raise exception 'Vul de naam van een stad in' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.kroegen k where lower(k.gemeente) = lower(v_stad)) then
    raise exception '% doet al mee', v_stad using errcode = 'P0001';
  end if;
  if exists (select 1 from public.stadsaanvragen s where s.door_id = ik and s.stad_sleutel = lower(v_stad)) then
    raise exception 'Je hebt % al aangevraagd', v_stad using errcode = 'P0001';
  end if;
  if (select count(*) from public.stadsaanvragen s where s.door_id = ik and s.op > now() - interval '1 day') >= 5 then
    raise exception 'Je hebt vandaag al 5 steden aangevraagd. Probeer het morgen weer.' using errcode = 'P0001';
  end if;
  insert into public.stadsaanvragen (door_id, stad) values (ik, v_stad) returning id into nieuw;
  return nieuw;
end;
$$;

revoke all on function private.vraag_stad_aan from public, anon, authenticated;
grant execute on function private.vraag_stad_aan to authenticated;

create or replace function public.vraag_stad_aan(p_stad text)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.vraag_stad_aan(p_stad);
$$;

revoke all on function public.vraag_stad_aan from public, anon, authenticated;
grant execute on function public.vraag_stad_aan to authenticated;

-- Beheerder: alle open aanvragen voor een stad op goedgekeurd of afgewezen zetten
create or replace function private.zet_stadsaanvraag(p_stad text, p_status text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  ik uuid := auth.uid();
  aantal integer;
begin
  if ik is null or not exists (select 1 from public.profielen where id = ik and is_beheerder) then
    raise exception 'Alleen voor beheerders' using errcode = '42501';
  end if;
  if p_status not in ('goedgekeurd', 'afgewezen') then
    raise exception 'Onbekende status' using errcode = 'P0001';
  end if;
  update public.stadsaanvragen
     set status = p_status, behandeld_op = now()
   where stad_sleutel = lower(trim(p_stad)) and status = 'open';
  get diagnostics aantal = row_count;
  return aantal;
end;
$$;

revoke all on function private.zet_stadsaanvraag from public, anon, authenticated;
grant execute on function private.zet_stadsaanvraag to authenticated;

create or replace function public.zet_stadsaanvraag(p_stad text, p_status text)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.zet_stadsaanvraag(p_stad, p_status);
$$;

revoke all on function public.zet_stadsaanvraag from public, anon, authenticated;
grant execute on function public.zet_stadsaanvraag to authenticated;
