-- BPDB-NL: betrouwbaarheid naar verwachting (idee van Elo, zonder tegenstander)
-- Voorlopig: Kjell is er nog niet tevreden over. Zie docs/concept.md, paragraaf 2.6.
--
-- Hoe verrassender de uitkomst, hoe groter de sprong:
--   * Bevestigde melding:  +10% van wat je nog mist tot 100.
--   * Weerlegde melding:   -20% van je huidige score.
--   * Juist oordeel:       +3% van wat je nog mist tot 100.
--   * Onjuist oordeel:     -6% van je huidige score.
-- Een beginner stijgt dus snel, een fout van iemand boven 90% kost bijna 20 punten.
-- Wie een fractie p van de tijd gelijk heeft, komt uit rond p / (p + 2 (1 - p)):
-- 95% goed geeft ongeveer 90%, 99% goed ongeveer 98%.
--
-- Ervaringsdrempel: boven 90% (dubbele stem, een bevestiging genoeg) kom je pas met
-- minstens 20 bevestigde eigen meldingen, bevestigd door minstens 5 verschillende andere
-- spelers. Tot die tijd blijft de score op hoogstens 90 staan. Zo kunnen twee vrienden
-- elkaar niet snel boven 90% helpen.
--
-- Bestaande scores blijven staan; de nieuwe regel geldt vanaf de volgende melding of het
-- volgende oordeel. De aanroepers (private.rond_af) blijven ongewijzigd: zij geven nog
-- steeds +2, -10, +1 of -3 door, en die worden hieronder vertaald naar een uitkomst.

-- Heeft deze speler genoeg ervaring voor een score boven 90?
create or replace function private.ervaren_melder(p_gebruiker uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct g.id) >= 20 and count(distinct b.door_id) >= 5
  from public.gebeurtenissen g
  left join public.bevestigingen b
    on b.gebeurtenis_id = g.id and b.oordeel = 'klopt' and b.door_id is not null and b.door_id <> g.door_id
  where g.door_id = p_gebruiker
    and g.status = 'bevestigd'
    and g.soort in ('eerst', 'wijziging');
$$;

-- Nieuwe score na een uitkomst.
--   p_soort: 'melding' of 'oordeel'; p_goed: of de speler gelijk had.
create or replace function private.betrouwbaarheid_na(p_gebruiker uuid, p_soort text, p_goed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  oud numeric;
  t numeric;
  stap_op numeric := case p_soort when 'melding' then 0.10 else 0.03 end;
  stap_neer numeric := case p_soort when 'melding' then 0.20 else 0.06 end;
begin
  if p_gebruiker is null then
    return;
  end if;
  select betrouwbaarheid into oud from public.profielen where id = p_gebruiker for update;
  if not found then
    return;
  end if;
  t := oud;
  if p_goed then
    t := t + stap_op * (100 - t);
    -- Zonder ervaring niet boven 90; een bestaande hogere score zakt hierdoor niet.
    if t > 90 and not private.ervaren_melder(p_gebruiker) then
      t := greatest(90, oud);
    end if;
  else
    t := t - stap_neer * t;
  end if;
  update public.profielen
  set betrouwbaarheid = round(least(100, greatest(0, t)), 2)
  where id = p_gebruiker;
end;
$$;

-- Oude ingang, gebruikt door private.rond_af. Vertaalt de vaste stappen naar een uitkomst.
create or replace function private.pas_betrouwbaarheid_aan(p_gebruiker uuid, p_delta numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.betrouwbaarheid_na(
    p_gebruiker,
    case when p_delta in (2, -10) then 'melding' else 'oordeel' end,
    p_delta > 0);
end;
$$;

revoke all on function private.ervaren_melder, private.betrouwbaarheid_na, private.pas_betrouwbaarheid_aan
  from public, anon, authenticated;
