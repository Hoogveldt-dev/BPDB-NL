-- Willekeurige spelersnamen zijn weer helemaal bier: alleen bierwoorden, geen dieren of algemene bijvoeglijke
-- naamwoorden meer (slimme-otter, wijze-uil). De eerste woordenlijst (20261110120000) liet dieren toe.
-- Bestaande automatische namen (naam_vast = false) met een niet-bierwoord krijgen een nieuwe biernaam.
-- Zelfgekozen namen blijven staan. Langste naam: 10 + 1 + 11 tekens, met nummer hooguit 24.

create or replace function private.willekeurige_naam()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  bijvoeglijk text[] := array[
    'dorstige', 'schuimende', 'frisse', 'gouden', 'bruisende', 'koele', 'blonde', 'donkere', 'hoppige', 'moutige',
    'bittere', 'troebele', 'heldere', 'volle', 'droge', 'zoete', 'stevige', 'lichte', 'ijskoude', 'verse'];
  zelfstandig text[] := array[
    'gerst', 'hop', 'mout', 'gist', 'schuimkraag', 'pul', 'kroes', 'tap', 'tapkraan', 'kurk',
    'stamgast', 'tapper', 'pint', 'pilsje', 'vaasje', 'fust', 'vaatje', 'bierviltje', 'dopje', 'brouwer',
    'tripel', 'dubbel', 'bokbier', 'weizen', 'stout', 'lager', 'ipa', 'radler', 'kroeg', 'rondje'];
  kandidaat text;
  basis text;
  n integer := 1;
begin
  for poging in 1..30 loop
    basis := bijvoeglijk[1 + floor(random() * array_length(bijvoeglijk, 1))::int]
      || '-' || zelfstandig[1 + floor(random() * array_length(zelfstandig, 1))::int];
    if not exists (select 1 from public.profielen p where lower(p.naam) = basis) then
      return basis;
    end if;
  end loop;
  kandidaat := basis;
  while exists (select 1 from public.profielen p where lower(p.naam) = kandidaat) loop
    n := n + 1;
    kandidaat := basis || n::text;
  end loop;
  return kandidaat;
end;
$$;

revoke execute on function private.willekeurige_naam() from public, anon, authenticated;

-- Bestaande automatische namen met een dier of een algemeen bijvoeglijk naamwoord omzetten.
update public.profielen
set naam = private.willekeurige_naam()
where naam_vast = false
  and (
    regexp_replace(split_part(lower(naam), '-', 2), '[0-9]+$', '') in (
      'zebra', 'vos', 'uil', 'das', 'otter', 'bever', 'egel', 'eend', 'mus', 'merel', 'reiger', 'ekster',
      'hommel', 'kikker', 'eekhoorn', 'zwaan', 'bel', 'kraag')
    or split_part(lower(naam), '-', 1) in (
      'gezellige', 'vrolijke', 'stoere', 'dappere', 'slimme', 'vlotte', 'trouwe', 'wijze', 'zuinige', 'zonnige',
      'kalme', 'gulle', 'fijne', 'rustige', 'snelle', 'deftige', 'eerlijke', 'brave', 'pittige', 'zachte'));
