-- Een foto van de kaart toevoegen, los van een prijsmelding.
--
-- Tot nu toe kon een foto van de prijslijst alleen mee met een prijsmelding (gebeurtenissen.foto_pad, +5 punten).
-- Wie de prijs al had doorgegeven, kon geen foto meer toevoegen. Nu kan iedereen, ook een anonieme speler, een
-- foto van de kaart bij een kroeg zetten. De foto gaat eerst naar de opslag (bucket prijslijsten, eigen map, zoals
-- bij een prijsmelding); meld_foto legt hem daarna vast bij de kroeg.
--
-- Spelregels:
--   - Geen punten en geen oordeel van andere spelers: het is een hulpmiddel om een prijs na te kijken, geen prijs.
--   - Hoogstens 10 foto's per speler per dag.
--   - Foto's zijn openbaar, net als de foto's bij een melding. Alleen de spelersnaam staat erbij.
--   - Schrijven gaat alleen via meld_foto; niemand wijzigt of wist een rij via de API. Een beheerder verwijdert
--     een ongepaste foto in de SQL Editor.

create table public.kroeg_fotos (
  id bigint generated always as identity primary key,
  kroeg_id bigint not null references public.kroegen (id) on delete cascade,
  door_id uuid references public.profielen (id) on delete set null,
  pad text not null unique check (pad ~ '^[0-9a-f-]{36}/[0-9]+-[0-9]+\.[a-z0-9]{2,5}$'),
  op timestamptz not null default now()
);
create index kroeg_fotos_kroeg_idx on public.kroeg_fotos (kroeg_id, op desc);
create index kroeg_fotos_door_idx on public.kroeg_fotos (door_id, op desc);
comment on table public.kroeg_fotos is 'Foto''s van de kaart bij een kroeg, los van een prijsmelding. Alleen via meld_foto; geen punten.';

alter table public.kroeg_fotos enable row level security;
revoke all on public.kroeg_fotos from anon, authenticated;
grant select on public.kroeg_fotos to anon, authenticated;
create policy "kaartfotos zijn openbaar" on public.kroeg_fotos for select to anon, authenticated using (true);

create or replace function private.meld_foto(p_kroeg_id bigint, p_pad text)
returns public.kroeg_fotos
language plpgsql
security definer
set search_path = ''
as $$
declare
  ik uuid := auth.uid();
  f public.kroeg_fotos;
begin
  if ik is null then
    raise exception 'Log eerst in' using errcode = '28000';
  end if;
  if not exists (select 1 from public.kroegen where id = p_kroeg_id) then
    raise exception 'Kroeg bestaat niet' using errcode = 'P0002';
  end if;
  if p_pad is null or p_pad !~ '^[0-9a-f-]{36}/[0-9]+-[0-9]+\.[a-z0-9]{2,5}$' then
    raise exception 'Dit is geen geldige foto' using errcode = 'P0001';
  end if;
  if split_part(p_pad, '/', 1) <> ik::text then
    raise exception 'Foto hoort niet bij jou' using errcode = '42501';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'prijslijsten' and o.name = p_pad) then
    raise exception 'De foto is niet aangekomen. Probeer het opnieuw' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.kroeg_fotos x where x.pad = p_pad) then
    raise exception 'Deze foto is al toegevoegd' using errcode = 'P0001';
  end if;
  if (select count(*) from public.kroeg_fotos x where x.door_id = ik and x.op > now() - interval '1 day') >= 10 then
    raise exception 'Je hebt vandaag al 10 foto''s toegevoegd. Probeer het morgen weer' using errcode = 'P0001';
  end if;
  insert into public.kroeg_fotos (kroeg_id, door_id, pad) values (p_kroeg_id, ik, p_pad) returning * into f;
  return f;
end;
$$;

create or replace function public.meld_foto(p_kroeg_id bigint, p_pad text)
returns public.kroeg_fotos
language sql
security invoker
set search_path = ''
as $$
  select * from private.meld_foto(p_kroeg_id, p_pad);
$$;

revoke all on function private.meld_foto(bigint, text) from public, anon, authenticated;
revoke all on function public.meld_foto(bigint, text) from public, anon, authenticated;
grant execute on function private.meld_foto(bigint, text) to authenticated;
grant execute on function public.meld_foto(bigint, text) to authenticated;

-- Overzicht voor de app: de foto's van een kroeg met de naam van wie ze toevoegde
create or replace view public.kroeg_foto_overzicht
with (security_invoker = true)
as
select f.id, f.kroeg_id, f.pad, f.op, f.door_id, p.naam as door
from public.kroeg_fotos f
left join public.profielen p on p.id = f.door_id;

grant select on public.kroeg_foto_overzicht to anon, authenticated;
