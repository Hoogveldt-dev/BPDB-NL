-- Willekeurige spelersnaam voor anonieme spelers
-- Wie zonder e-mailadres begint, kiest geen naam meer, maar krijgt er een: bijvoorbeeld dorstige-zebra of
-- schuimende-gerst (bijvoeglijk naamwoord, streepje, iets met bier of een dier). Een eigen naam kies je zodra je
-- een e-mailadres (of Apple of Google) koppelt; het account blijft hetzelfde, met alle punten en check-ins.
-- Zo kunnen wegwerpaccounts geen eigen (aanstootgevende) naam op de ranglijst zetten.
-- Spelers die zonder naam via e-mail, Apple of Google beginnen, krijgen ook een willekeurige naam in plaats van
-- speler, speler2, ... en kiezen daarna een keer zelf (zoals in 20261106160000_vaste_spelersnaam).

-- Een willekeurige naam die nog vrij is. Eerst een paar pogingen zonder nummer; zijn die allemaal bezet,
-- dan een nummer erachter (dorstige-zebra2). Langste naam: 10 + 1 + 11 tekens, met nummer hooguit 24.
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
    'gezellige', 'vrolijke', 'stoere', 'dappere', 'slimme', 'vlotte', 'trouwe', 'wijze', 'zuinige', 'zonnige',
    'kalme', 'gulle', 'fijne', 'rustige', 'snelle', 'deftige', 'eerlijke', 'brave', 'pittige', 'zachte'];
  zelfstandig text[] := array[
    'gerst', 'hop', 'mout', 'gist', 'kraag', 'schuimkraag', 'pul', 'kroes', 'tap', 'tapkraan',
    'kurk', 'bel', 'stamgast', 'tapper', 'zebra', 'vos', 'uil', 'das', 'otter', 'bever',
    'egel', 'eend', 'mus', 'merel', 'reiger', 'ekster', 'hommel', 'kikker', 'eekhoorn', 'zwaan'];
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

-- Nieuw profiel: zoals in 20261106160000_vaste_spelersnaam, maar een anonieme speler krijgt altijd een
-- willekeurige naam (ook als de app er een meestuurt), en wie zonder naam begint ook.
create or replace function private.nieuw_profiel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  basis text;
  kandidaat text;
  n integer := 1;
begin
  -- De naam is alleen weergave; autorisatie gebruikt nooit user_metadata.
  basis := case when new.is_anonymous then null else nullif(trim(new.raw_user_meta_data ->> 'naam'), '') end;
  basis := left(regexp_replace(basis, '[^[:alnum:] _.-]', '', 'g'), 24);
  if basis is null or char_length(basis) < 2 then
    insert into public.profielen (id, naam, naam_vast) values (new.id, private.willekeurige_naam(), false);
    return new;
  end if;
  kandidaat := basis;
  while exists (select 1 from public.profielen p where lower(p.naam) = lower(kandidaat)) loop
    n := n + 1;
    kandidaat := basis || n::text;
  end loop;
  insert into public.profielen (id, naam, naam_vast) values (new.id, kandidaat, true);
  return new;
end;
$$;

-- Een anonieme speler kiest nog geen eigen naam; eerst een e-mailadres (of Apple of Google) koppelen.
-- Alleen de speler zelf wordt tegengehouden: een beheerder in de SQL Editor heeft geen auth.uid().
create or replace function private.naam_niet_anoniem()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.naam is distinct from old.naam and auth.uid() = new.id
     and exists (select 1 from auth.users u where u.id = new.id and u.is_anonymous) then
    raise exception 'Koppel eerst je e-mailadres (tabblad Ik) om een eigen spelersnaam te kiezen'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function private.naam_niet_anoniem() from public, anon, authenticated;

create trigger profielen_naam_niet_anoniem
  before update of naam on public.profielen
  for each row execute function private.naam_niet_anoniem();
