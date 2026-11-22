-- Bug melden wordt een algemene knop voor vragen, suggesties, problemen en opmerkingen (Ik, "Vraag, idee of
-- probleem"). Tabel en functie heten nog bugmeldingen en meld_bug; alleen de foutmeldingen die een speler ziet,
-- gaan nu over een bericht in plaats van een bug. Verder verandert er niets: hoogstens 10 per speler per dag,
-- alleen beheerders lezen ze.

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
    raise exception 'Schrijf je bericht in een paar woorden' using errcode = 'P0001';
  end if;
  if char_length(v_tekst) > 2000 then
    raise exception 'Houd je bericht korter dan 2000 tekens' using errcode = 'P0001';
  end if;
  if (select count(*) from public.bugmeldingen b where b.door_id = ik and b.op > now() - interval '1 day') >= 10 then
    raise exception 'Je hebt vandaag al 10 berichten gestuurd. Probeer het morgen weer.' using errcode = 'P0001';
  end if;
  insert into public.bugmeldingen (door_id, tekst, scherm, apparaat)
  values (ik, v_tekst, left(nullif(trim(p_scherm), ''), 200), left(nullif(trim(p_apparaat), ''), 400))
  returning id into nieuw;
  return nieuw;
end;
$$;

revoke all on function private.meld_bug from public, anon, authenticated;
grant execute on function private.meld_bug to authenticated;

comment on table public.bugmeldingen is 'Berichten van spelers (vragen, suggesties, problemen, opmerkingen): tekst, schermgrootte en browser. Alleen beheerders lezen ze; schrijven alleen via meld_bug.';
