-- Teksten van de app, aan te passen door een beheerder.
--
-- De app zoekt elke zichtbare tekst op in deze tabel (sleutel = de standaardtekst, met elk getal
-- vervangen door #). Staat er een eigen tekst, dan toont de app die; de # wordt weer het getal.
-- Zo kan een beheerder elke tekst herschrijven zonder dat er code verandert.
--
-- Iedereen mag lezen. Schrijven gaat alleen via zet_tekst, en alleen voor beheerders.
-- Een lege tekst haalt de eigen tekst weg: dan staat de standaardtekst er weer.

create table public.app_teksten (
  sleutel text primary key check (char_length(sleutel) between 1 and 2000),
  tekst text not null check (char_length(tekst) between 1 and 2000),
  door_id uuid references public.profielen (id) on delete set null,
  bijgewerkt_op timestamptz not null default now()
);
comment on table public.app_teksten is 'Eigen teksten van de beheerder; sleutel is de standaardtekst met getallen als #. Alleen via zet_tekst.';

alter table public.app_teksten enable row level security;
revoke all on public.app_teksten from anon, authenticated;
grant select on public.app_teksten to anon, authenticated;
create policy "teksten zijn openbaar" on public.app_teksten for select to anon, authenticated using (true);

create or replace function private.zet_tekst(p_sleutel text, p_tekst text)
returns public.app_teksten
language plpgsql
security definer
set search_path = ''
as $$
declare
  ik uuid := auth.uid();
  v_sleutel text := trim(coalesce(p_sleutel, ''));
  v_tekst text := trim(coalesce(p_tekst, ''));
  rij public.app_teksten;
begin
  if ik is null then
    raise exception 'Log eerst in' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profielen where id = ik and is_beheerder) then
    raise exception 'Alleen een beheerder kan teksten aanpassen' using errcode = '42501';
  end if;
  if v_sleutel = '' or char_length(v_sleutel) > 2000 then
    raise exception 'Deze tekst kan niet worden aangepast' using errcode = 'P0001';
  end if;
  if char_length(v_tekst) > 2000 then
    raise exception 'Houd de tekst korter dan 2000 tekens' using errcode = 'P0001';
  end if;

  -- Leeg, of weer gelijk aan de standaardtekst: de eigen tekst verdwijnt
  if v_tekst = '' or v_tekst = v_sleutel then
    delete from public.app_teksten t where t.sleutel = v_sleutel returning * into rij;
    return rij;
  end if;
  insert into public.app_teksten (sleutel, tekst, door_id)
  values (v_sleutel, v_tekst, ik)
  on conflict (sleutel) do update set tekst = excluded.tekst, door_id = excluded.door_id, bijgewerkt_op = now()
  returning * into rij;
  return rij;
end;
$$;

revoke all on function private.zet_tekst from public, anon, authenticated;

create or replace function public.zet_tekst(p_sleutel text, p_tekst text)
returns public.app_teksten
language sql
security invoker
set search_path = ''
as $$
  select * from private.zet_tekst(p_sleutel, p_tekst);
$$;

revoke all on function public.zet_tekst from public, anon, authenticated;
grant execute on function public.zet_tekst to authenticated;
grant execute on function private.zet_tekst to authenticated;
