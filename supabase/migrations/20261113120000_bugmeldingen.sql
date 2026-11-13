-- Bugs melden vanuit de app (tabblad Ik).
--
-- Elke speler, ook een anonieme, kan een bug melden met een korte omschrijving. De app stuurt mee op welk
-- scherm de speler was en welke browser hij gebruikt, zodat de bug na te spelen is. Geen locatie.
-- Alleen beheerders lezen de meldingen; schrijven gaat alleen via meld_bug, hoogstens 10 per speler per dag.

create table public.bugmeldingen (
  id bigint generated always as identity primary key,
  door_id uuid references public.profielen (id) on delete set null,
  tekst text not null check (char_length(tekst) between 5 and 2000),
  scherm text check (scherm is null or char_length(scherm) <= 200),
  apparaat text check (apparaat is null or char_length(apparaat) <= 400),
  op timestamptz not null default now()
);
create index bugmeldingen_op_idx on public.bugmeldingen (op desc);
create index bugmeldingen_door_idx on public.bugmeldingen (door_id);
comment on table public.bugmeldingen is 'Bugs gemeld door spelers. Alleen beheerders lezen ze; schrijven alleen via meld_bug.';

alter table public.bugmeldingen enable row level security;
revoke all on public.bugmeldingen from anon, authenticated;
grant select on public.bugmeldingen to authenticated;
create policy "beheerders lezen bugmeldingen" on public.bugmeldingen
  for select to authenticated
  using (exists (select 1 from public.profielen p where p.id = (select auth.uid()) and p.is_beheerder));

create or replace function private.meld_bug(p_tekst text, p_scherm text, p_apparaat text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  ik uuid := auth.uid();
  v_tekst text := trim(coalesce(p_tekst, ''));
  nieuw bigint;
begin
  if ik is null then
    raise exception 'Log eerst in' using errcode = '28000';
  end if;
  if char_length(v_tekst) < 5 then
    raise exception 'Beschrijf de bug in een paar woorden' using errcode = 'P0001';
  end if;
  if char_length(v_tekst) > 2000 then
    raise exception 'Houd de beschrijving korter dan 2000 tekens' using errcode = 'P0001';
  end if;
  if (select count(*) from public.bugmeldingen b where b.door_id = ik and b.op > now() - interval '1 day') >= 10 then
    raise exception 'Je hebt vandaag al 10 bugs gemeld. Probeer het morgen weer.' using errcode = 'P0001';
  end if;
  insert into public.bugmeldingen (door_id, tekst, scherm, apparaat)
  values (ik, v_tekst, left(nullif(trim(p_scherm), ''), 200), left(nullif(trim(p_apparaat), ''), 400))
  returning id into nieuw;
  return nieuw;
end;
$$;

revoke all on function private.meld_bug from public, anon, authenticated;
grant execute on function private.meld_bug to authenticated;

create or replace function public.meld_bug(p_tekst text, p_scherm text default null, p_apparaat text default null)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.meld_bug(p_tekst, p_scherm, p_apparaat);
$$;

revoke all on function public.meld_bug from public, anon, authenticated;
grant execute on function public.meld_bug to authenticated;
