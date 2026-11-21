-- Een mail naar de beheerder bij een nieuwe bug of stadsaanvraag.
--
-- De app roept na een geslaagde melding de Edge Function melding-mail aan. Die verstuurt de mail via de
-- Infomaniak-mailbox van Bierkoers. Deze migratie regelt dat elke melding hoogstens een keer wordt gemaild en
-- dat alleen de melder zelf, kort na het melden, de mail kan laten versturen: claim_melding_mail zet
-- gemaild_op, controleert de melder en geeft de gegevens voor de mail terug. Alleen de service_role mag hem
-- aanroepen (de Edge Function, die de sessie van de speler controleert).

alter table public.bugmeldingen add column gemaild_op timestamptz;
alter table public.stadsaanvragen add column gemaild_op timestamptz;

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
  else
    raise exception 'Onbekende soort melding' using errcode = 'P0001';
  end if;
  return r; -- null: al gemaild, niet van deze speler, of te oud
end;
$$;

create or replace function public.claim_melding_mail(p_soort text, p_id bigint, p_door uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.claim_melding_mail(p_soort, p_id, p_door);
$$;

revoke all on function public.claim_melding_mail(text, bigint, uuid) from public, anon, authenticated;
revoke all on function private.claim_melding_mail(text, bigint, uuid) from public, anon, authenticated;
grant execute on function public.claim_melding_mail(text, bigint, uuid) to service_role;
grant execute on function private.claim_melding_mail(text, bigint, uuid) to service_role;
