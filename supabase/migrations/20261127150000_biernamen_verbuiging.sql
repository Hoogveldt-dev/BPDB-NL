-- Meer diversiteit in de willekeurige spelersnamen, en bijvoeglijke naamwoorden die kloppen met het zelfstandig
-- naamwoord: een de-woord krijgt de e-vorm (koele pul, gouden pint), een het-woord de grondvorm (koel pilsje,
-- moutig vaasje). Bijvoeglijk en zelfstandig naamwoord staan daarom in gepaarde lijsten.
-- Langste naam: 10 + 1 + 11 tekens, met nummer hooguit 24.

create or replace function private.willekeurige_naam()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- grondvorm (voor het-woorden) en e-vorm (voor de-woorden), op dezelfde plek in beide lijsten
  adj_grond text[] := array[
    'dorstig', 'schuimend', 'fris', 'gouden', 'bruisend', 'koel', 'blond', 'donker', 'hoppig', 'moutig',
    'bitter', 'troebel', 'helder', 'vol', 'droog', 'zoet', 'stevig', 'licht', 'ijskoud', 'vers',
    'gezellig', 'lekker', 'romig', 'krachtig', 'fruitig', 'kruidig', 'zuiver', 'rijk', 'bruin', 'pittig',
    'mild', 'zacht', 'vurig', 'geurig', 'gul', 'mooi', 'trots', 'getapt', 'gerijpt', 'gefilterd',
    'gistend', 'rijp', 'jong', 'oud', 'goudgeel', 'koperen', 'rokerig', 'vrolijk', 'tevreden', 'stoer',
    'dapper', 'vlot', 'trouw', 'wijs', 'zuinig', 'zonnig', 'kalm', 'rustig', 'snel', 'eerlijk'];
  adj_e text[] := array[
    'dorstige', 'schuimende', 'frisse', 'gouden', 'bruisende', 'koele', 'blonde', 'donkere', 'hoppige', 'moutige',
    'bittere', 'troebele', 'heldere', 'volle', 'droge', 'zoete', 'stevige', 'lichte', 'ijskoude', 'verse',
    'gezellige', 'lekkere', 'romige', 'krachtige', 'fruitige', 'kruidige', 'zuivere', 'rijke', 'bruine', 'pittige',
    'milde', 'zachte', 'vurige', 'geurige', 'gulle', 'mooie', 'trotse', 'getapte', 'gerijpte', 'gefilterde',
    'gistende', 'rijpe', 'jonge', 'oude', 'goudgele', 'koperen', 'rokerige', 'vrolijke', 'tevreden', 'stoere',
    'dappere', 'vlotte', 'trouwe', 'wijze', 'zuinige', 'zonnige', 'kalme', 'rustige', 'snelle', 'eerlijke'];
  de_woord text[] := array[
    'gerst', 'hop', 'mout', 'gist', 'schuimkraag', 'pul', 'kroes', 'tap', 'tapkraan', 'kurk',
    'stamgast', 'tapper', 'pint', 'brouwer', 'tripel', 'dubbel', 'stout', 'ipa', 'radler', 'kroeg',
    'bokaal', 'tulp', 'kroegtijger', 'bierpomp', 'proost', 'borrel', 'bierkaart', 'brouwerij', 'bierton', 'dorst'];
  het_woord text[] := array[
    'pilsje', 'vaasje', 'fust', 'vaatje', 'bierviltje', 'dopje', 'rondje', 'bokbier', 'weizen', 'lager',
    'biertje', 'blondje', 'glas', 'vat', 'kratje', 'flesje', 'schuim', 'tapbier', 'tarwebier', 'terras',
    'fustje', 'halfje', 'wit', 'bruin', 'trappist', 'abdijbier', 'tafelbier', 'zomerbier', 'winterbier', 'herfstbier'];
  kandidaat text;
  basis text;
  n integer := 1;
  a integer;
  z integer;
  aantal_de integer := array_length(de_woord, 1);
  aantal_het integer := array_length(het_woord, 1);
begin
  for poging in 1..60 loop
    a := 1 + floor(random() * array_length(adj_grond, 1))::int;
    z := 1 + floor(random() * (aantal_de + aantal_het))::int;
    if z <= aantal_de then
      basis := adj_e[a] || '-' || de_woord[z];
    else
      basis := adj_grond[a] || '-' || het_woord[z - aantal_de];
    end if;
    if char_length(basis) <= 21 and not exists (select 1 from public.profielen p where lower(p.naam) = basis) then
      return basis;
    end if;
  end loop;
  basis := adj_grond[1] || '-' || het_woord[1];
  kandidaat := basis;
  while exists (select 1 from public.profielen p where lower(p.naam) = kandidaat) loop
    n := n + 1;
    kandidaat := basis || n::text;
  end loop;
  return kandidaat;
end;
$$;

revoke execute on function private.willekeurige_naam() from public, anon, authenticated;

-- Bestaande automatische namen met een het-woord en de e-vorm (moutige-pilsje) krijgen de grondvorm (moutig-pilsje).
-- Zelfgekozen namen (naam_vast) blijven staan.
update public.profielen
set naam = case split_part(lower(naam), '-', 1)
    when 'dorstige' then 'dorstig' when 'schuimende' then 'schuimend' when 'frisse' then 'fris'
    when 'bruisende' then 'bruisend' when 'koele' then 'koel' when 'blonde' then 'blond'
    when 'donkere' then 'donker' when 'hoppige' then 'hoppig' when 'moutige' then 'moutig'
    when 'bittere' then 'bitter' when 'troebele' then 'troebel' when 'heldere' then 'helder'
    when 'volle' then 'vol' when 'droge' then 'droog' when 'zoete' then 'zoet'
    when 'stevige' then 'stevig' when 'lichte' then 'licht' when 'ijskoude' then 'ijskoud'
    when 'verse' then 'vers' end
  || '-' || split_part(lower(naam), '-', 2)
where naam_vast = false
  and split_part(lower(naam), '-', 1) in (
    'dorstige', 'schuimende', 'frisse', 'bruisende', 'koele', 'blonde', 'donkere', 'hoppige', 'moutige', 'bittere',
    'troebele', 'heldere', 'volle', 'droge', 'zoete', 'stevige', 'lichte', 'ijskoude', 'verse')
  and regexp_replace(split_part(lower(naam), '-', 2), '[0-9]+$', '') in (
    'pilsje', 'vaasje', 'fust', 'vaatje', 'bierviltje', 'dopje', 'rondje', 'bokbier', 'weizen', 'lager')
  and not exists (select 1 from public.profielen q where lower(q.naam) = lower(
    case split_part(lower(profielen.naam), '-', 1)
    when 'dorstige' then 'dorstig' when 'schuimende' then 'schuimend' when 'frisse' then 'fris'
    when 'bruisende' then 'bruisend' when 'koele' then 'koel' when 'blonde' then 'blond'
    when 'donkere' then 'donker' when 'hoppige' then 'hoppig' when 'moutige' then 'moutig'
    when 'bittere' then 'bitter' when 'troebele' then 'troebel' when 'heldere' then 'helder'
    when 'volle' then 'vol' when 'droge' then 'droog' when 'zoete' then 'zoet'
    when 'stevige' then 'stevig' when 'lichte' then 'licht' when 'ijskoude' then 'ijskoud'
    when 'verse' then 'vers' end
    || '-' || split_part(lower(profielen.naam), '-', 2)));
