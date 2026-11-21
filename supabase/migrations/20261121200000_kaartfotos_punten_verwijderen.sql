-- Punten voor een foto van de kaart, en je eigen foto kunnen verwijderen.
--
-- Spelregels (Kjell, 21 november 2026):
--   - +5 punten voor de eerste foto die je bij een kroeg zet. Nog een foto bij dezelfde kroeg levert niets op, en
--     een foto die je verwijdert en opnieuw uploadt ook niet: de eerdere foto telt mee, ook een verwijderde.
--     Zo is er hoogstens 5 punten per kroeg per speler te halen, en niets te farmen met uploaden en wissen.
--   - Verwijder je de foto waarvoor je de punten kreeg, dan gaan die punten eraf.
--   - Je verwijdert alleen je eigen foto. Een beheerder verwijdert een andere foto in de SQL Editor (zie ACTIES.md).
--   - Een verwijderde foto verdwijnt voor iedereen uit het overzicht; de rij blijft staan (verwijderd_op), zodat de
--     daglimiet van 10 en de regel "eerste foto per kroeg" kloppen. De app haalt ook het bestand uit de opslag.
--   - Voor de punten bij samenvoegen (anonieme speler logt in met een bestaand account) geldt wat voor alle punten
--     geldt: ze gaan mee. De foto verliest dan wel zijn naam, want de anonieme speler wordt verwijderd.

alter table public.kroeg_fotos
  add column punten smallint not null default 0,
  add column verwijderd_op timestamptz;

alter table public.punten add column kaartfoto_id bigint references public.kroeg_fotos (id) on delete set null;
create index punten_kaartfoto_idx on public.punten (kaartfoto_id) where kaartfoto_id is not null;

-- Een verwijderde foto is voor niemand meer te lezen
drop policy "kaartfotos zijn openbaar" on public.kroeg_fotos;
create policy "kaartfotos zijn openbaar" on public.kroeg_fotos for select to anon, authenticated using (verwijderd_op is null);

create or replace function private.meld_foto(p_kroeg_id bigint, p_pad text)
returns public.kroeg_fotos
language plpgsql
security definer
set search_path = ''
as $$
declare
  ik uuid := auth.uid();
  f public.kroeg_fotos;
  eerste boolean;
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
  -- De daglimiet telt ook verwijderde foto's mee
  if (select count(*) from public.kroeg_fotos x where x.door_id = ik and x.op > now() - interval '1 day') >= 10 then
    raise exception 'Je hebt vandaag al 10 foto''s toegevoegd. Probeer het morgen weer' using errcode = 'P0001';
  end if;
  eerste := not exists (select 1 from public.kroeg_fotos x where x.kroeg_id = p_kroeg_id and x.door_id = ik);
  insert into public.kroeg_fotos (kroeg_id, door_id, pad, punten)
  values (p_kroeg_id, ik, p_pad, case when eerste then 5 else 0 end)
  returning * into f;
  if eerste then
    insert into public.punten (gebruiker_id, reden, punten, kaartfoto_id) values (ik, 'kaartfoto', 5, f.id);
  end if;
  return f;
end;
$$;

-- Je eigen foto verwijderen; geeft het pad terug zodat de app ook het bestand uit de opslag haalt
create or replace function private.verwijder_foto(p_id bigint)
returns text
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
  select * into f from public.kroeg_fotos where id = p_id and verwijderd_op is null for update;
  if not found then
    raise exception 'Deze foto bestaat niet' using errcode = 'P0002';
  end if;
  if f.door_id is distinct from ik then
    raise exception 'Je kunt alleen je eigen foto verwijderen' using errcode = '42501';
  end if;
  update public.kroeg_fotos set verwijderd_op = now() where id = f.id;
  delete from public.punten where kaartfoto_id = f.id;
  return f.pad;
end;
$$;

create or replace function public.verwijder_foto(p_id bigint)
returns text
language sql
security invoker
set search_path = ''
as $$
  select private.verwijder_foto(p_id);
$$;

revoke all on function private.verwijder_foto(bigint) from public, anon, authenticated;
revoke all on function public.verwijder_foto(bigint) from public, anon, authenticated;
grant execute on function private.verwijder_foto(bigint) to authenticated;
grant execute on function public.verwijder_foto(bigint) to authenticated;

-- Het overzicht van de app: alleen foto's die er nog zijn (de leesregel hierboven doet dat al; dit maakt het zichtbaar)
create or replace view public.kroeg_foto_overzicht
with (security_invoker = true)
as
select f.id, f.kroeg_id, f.pad, f.op, f.door_id, p.naam as door
from public.kroeg_fotos f
left join public.profielen p on p.id = f.door_id
where f.verwijderd_op is null;

grant select on public.kroeg_foto_overzicht to anon, authenticated;
