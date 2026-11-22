-- Inbox voor berichten: een bericht van een speler wordt een gesprek.
--
-- Een beheerder antwoordt in de app (Ik, Beheer, Berichten) en de speler leest het antwoord onder Ik, Jouw
-- berichten, en antwoordt daar weer op. Heeft de speler een e-mailadres, dan krijgt hij het antwoord ook per mail
-- (Edge Function melding-mail, soort "antwoord"); een antwoord van de speler gaat per mail naar de beheerder.
--
-- - bugmeldingen krijgt een status (open of afgehandeld), het moment van het laatste bericht in het gesprek, of dat
--   van de beheerder kwam, en tot wanneer beheerder en speler het gesprek gelezen hebben. Daaruit volgt wat nieuw is.
-- - bericht_antwoorden: de antwoorden in een gesprek, van de beheerder of van de speler die het bericht stuurde.
-- - Een speler leest zijn eigen berichten en de antwoorden erop; een beheerder leest alles. Schrijven gaat alleen
--   via beantwoord_bericht, lees_bericht en zet_bericht_status.

alter table public.bugmeldingen
  add column status text not null default 'open' check (status in ('open', 'afgehandeld')),
  add column laatste_op timestamptz,
  add column laatste_van_beheer boolean not null default false,
  add column beheer_gelezen_op timestamptz,
  add column speler_gelezen_op timestamptz;
update public.bugmeldingen set laatste_op = op;
alter table public.bugmeldingen alter column laatste_op set not null, alter column laatste_op set default now();
create index bugmeldingen_laatste_idx on public.bugmeldingen (laatste_op desc);

comment on table public.bugmeldingen is 'Berichten van spelers (vragen, suggesties, problemen, opmerkingen): tekst, schermgrootte en browser. Elk bericht is een gesprek met de antwoorden in bericht_antwoorden. De speler leest zijn eigen berichten, een beheerder alles; schrijven alleen via meld_bug, beantwoord_bericht, lees_bericht en zet_bericht_status.';

create policy "spelers lezen hun eigen berichten" on public.bugmeldingen
  for select to authenticated
  using (door_id = (select auth.uid()));

create table public.bericht_antwoorden (
  id bigint generated always as identity primary key,
  bericht_id bigint not null references public.bugmeldingen (id) on delete cascade,
  door_id uuid references public.profielen (id) on delete set null,
  van_beheer boolean not null,
  tekst text not null check (char_length(tekst) between 1 and 2000),
  op timestamptz not null default now(),
  gemaild_op timestamptz
);
create index bericht_antwoorden_bericht_idx on public.bericht_antwoorden (bericht_id, op);
create index bericht_antwoorden_door_idx on public.bericht_antwoorden (door_id);
comment on table public.bericht_antwoorden is 'Antwoorden in een gesprek over een bericht: van een beheerder of van de speler die het bericht stuurde. Schrijven alleen via beantwoord_bericht.';

alter table public.bericht_antwoorden enable row level security;
revoke all on public.bericht_antwoorden from anon, authenticated;
grant select on public.bericht_antwoorden to authenticated;
create policy "speler en beheerder lezen antwoorden" on public.bericht_antwoorden
  for select to authenticated
  using (
    exists (select 1 from public.profielen p where p.id = (select auth.uid()) and p.is_beheerder)
    or exists (select 1 from public.bugmeldingen b where b.id = bericht_id and b.door_id = (select auth.uid()))
  );

-- Antwoorden in een gesprek. Een beheerder antwoordt op elk bericht; een speler alleen op zijn eigen bericht,
-- hoogstens 20 antwoorden per dag. Een antwoord van de speler zet een afgehandeld gesprek weer open.
create or replace function private.beantwoord_bericht(p_bericht bigint, p_tekst text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  ik uuid := auth.uid();
  v_tekst text := trim(coalesce(p_tekst, ''));
  v_door uuid;
  beheer boolean;
  nieuw bigint;
begin
  if ik is null then
    raise exception 'Log eerst in' using errcode = '28000';
  end if;
  if v_tekst = '' then
    raise exception 'Schrijf eerst je antwoord' using errcode = 'P0001';
  end if;
  if char_length(v_tekst) > 2000 then
    raise exception 'Houd je antwoord korter dan 2000 tekens' using errcode = 'P0001';
  end if;
  select b.door_id into v_door from public.bugmeldingen b where b.id = p_bericht for update;
  if not found then
    raise exception 'Dit bericht bestaat niet' using errcode = 'P0001';
  end if;
  beheer := exists (select 1 from public.profielen p where p.id = ik and p.is_beheerder);
  if not beheer and v_door is distinct from ik then
    raise exception 'Je kunt alleen op je eigen berichten antwoorden' using errcode = '42501';
  end if;
  if not beheer and (select count(*) from public.bericht_antwoorden a
                     where a.door_id = ik and a.op > now() - interval '1 day') >= 20 then
    raise exception 'Je hebt vandaag al 20 antwoorden gestuurd. Probeer het morgen weer.' using errcode = 'P0001';
  end if;
  insert into public.bericht_antwoorden (bericht_id, door_id, van_beheer, tekst)
  values (p_bericht, ik, beheer, v_tekst)
  returning id into nieuw;
  update public.bugmeldingen b
     set laatste_op = now(),
         laatste_van_beheer = beheer,
         status = case when beheer then b.status else 'open' end,
         beheer_gelezen_op = case when beheer then now() else b.beheer_gelezen_op end,
         speler_gelezen_op = case when b.door_id = ik then now() else b.speler_gelezen_op end
   where b.id = p_bericht;
  return nieuw;
end;
$$;

-- Gelezen: de beheerder of de speler van het bericht heeft het gesprek tot nu gelezen
create or replace function private.lees_bericht(p_bericht bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ik uuid := auth.uid();
  beheer boolean;
begin
  if ik is null then
    raise exception 'Log eerst in' using errcode = '28000';
  end if;
  beheer := exists (select 1 from public.profielen p where p.id = ik and p.is_beheerder);
  update public.bugmeldingen b
     set beheer_gelezen_op = case when beheer then now() else b.beheer_gelezen_op end,
         speler_gelezen_op = case when b.door_id = ik then now() else b.speler_gelezen_op end
   where b.id = p_bericht and (beheer or b.door_id = ik);
  if not found then
    raise exception 'Dit bericht bestaat niet' using errcode = 'P0001';
  end if;
end;
$$;

-- Afhandelen of weer openen: alleen een beheerder
create or replace function private.zet_bericht_status(p_bericht bigint, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profielen p where p.id = auth.uid() and p.is_beheerder) then
    raise exception 'Alleen een beheerder handelt berichten af' using errcode = '42501';
  end if;
  if p_status not in ('open', 'afgehandeld') then
    raise exception 'Onbekende status' using errcode = 'P0001';
  end if;
  update public.bugmeldingen b set status = p_status, beheer_gelezen_op = now() where b.id = p_bericht;
  if not found then
    raise exception 'Dit bericht bestaat niet' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function private.beantwoord_bericht(bigint, text) from public, anon, authenticated;
revoke all on function private.lees_bericht(bigint) from public, anon, authenticated;
revoke all on function private.zet_bericht_status(bigint, text) from public, anon, authenticated;
grant execute on function private.beantwoord_bericht(bigint, text) to authenticated;
grant execute on function private.lees_bericht(bigint) to authenticated;
grant execute on function private.zet_bericht_status(bigint, text) to authenticated;

create or replace function public.beantwoord_bericht(p_bericht bigint, p_tekst text)
returns bigint language sql security invoker set search_path = ''
as $$ select private.beantwoord_bericht(p_bericht, p_tekst); $$;
create or replace function public.lees_bericht(p_bericht bigint)
returns void language sql security invoker set search_path = ''
as $$ select private.lees_bericht(p_bericht); $$;
create or replace function public.zet_bericht_status(p_bericht bigint, p_status text)
returns void language sql security invoker set search_path = ''
as $$ select private.zet_bericht_status(p_bericht, p_status); $$;

revoke all on function public.beantwoord_bericht(bigint, text) from public, anon, authenticated;
revoke all on function public.lees_bericht(bigint) from public, anon, authenticated;
revoke all on function public.zet_bericht_status(bigint, text) from public, anon, authenticated;
grant execute on function public.beantwoord_bericht(bigint, text) to authenticated;
grant execute on function public.lees_bericht(bigint) to authenticated;
grant execute on function public.zet_bericht_status(bigint, text) to authenticated;

-- De mail bij een antwoord: claim_melding_mail kent nu ook de soort "antwoord". Alleen wie het antwoord schreef,
-- kort erna, laat hem mailen. De Edge Function zoekt bij een antwoord van de beheerder het e-mailadres van de
-- speler op (speler); een antwoord van de speler gaat naar de beheerder.
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
  else
    raise exception 'Onbekende soort melding' using errcode = 'P0001';
  end if;
  return r; -- null: al gemaild, niet van deze speler, of te oud
end;
$$;

revoke all on function private.claim_melding_mail(text, bigint, uuid) from public, anon, authenticated;
grant execute on function private.claim_melding_mail(text, bigint, uuid) to service_role;

-- Nieuwe berichten en antwoorden meteen zien (realtime volgt de leesregels hierboven)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.bugmeldingen, public.bericht_antwoorden;
  end if;
end;
$$;
