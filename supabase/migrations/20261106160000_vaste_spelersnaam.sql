-- Vaste spelersnaam: wie een naam kiest, houdt die. Spelers met een automatische naam
-- (speler, speler2, ... bijvoorbeeld na inloggen met Apple of Google) mogen een keer zelf een naam kiezen.
-- Een beheerder kan in de SQL-editor (als postgres of service_role) altijd een naam wijzigen.

alter table public.profielen add column naam_vast boolean not null default false;
comment on column public.profielen.naam_vast is 'true zodra de speler zelf een naam heeft gekozen; daarna kan hij die niet meer wijzigen.';

-- Bestaande spelers: een zelfgekozen naam staat vast, een automatische naam nog niet.
update public.profielen set naam_vast = naam !~ '^speler[0-9]*$';

-- Nieuw profiel: zoals in 20261106090000_anonieme_spelers, maar een meegegeven naam staat meteen vast.
create or replace function private.nieuw_profiel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  basis text;
  kandidaat text;
  gekozen boolean;
  n integer := 1;
begin
  -- De naam is alleen weergave; autorisatie gebruikt nooit user_metadata.
  basis := coalesce(nullif(trim(new.raw_user_meta_data ->> 'naam'), ''), 'speler');
  basis := left(regexp_replace(basis, '[^[:alnum:] _.-]', '', 'g'), 24);
  if char_length(basis) < 2 then
    basis := 'speler';
  end if;
  gekozen := basis <> 'speler';
  kandidaat := basis;
  while exists (select 1 from public.profielen p where lower(p.naam) = lower(kandidaat)) loop
    n := n + 1;
    kandidaat := basis || n::text;
  end loop;
  insert into public.profielen (id, naam, naam_vast) values (new.id, kandidaat, gekozen);
  return new;
end;
$$;

-- Bij elke wijziging van de naam door een speler: alleen als hij nog niet vaststaat, en daarna staat hij vast.
create or replace function private.naam_eenmalig()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.naam is distinct from old.naam and current_user in ('authenticated', 'anon') then
    if old.naam_vast then
      raise exception 'Je spelersnaam staat vast en kan niet meer worden gewijzigd' using errcode = 'P0001';
    end if;
    new.naam_vast := true;
  end if;
  return new;
end;
$$;

revoke execute on function private.naam_eenmalig() from public, anon, authenticated;

create trigger profielen_naam_eenmalig
  before update of naam on public.profielen
  for each row execute function private.naam_eenmalig();
