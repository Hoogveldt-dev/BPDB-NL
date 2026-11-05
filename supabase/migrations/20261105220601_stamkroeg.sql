-- BPDB-NL: stamkroeg
-- Per kroeg telt hoe vaak elke speler de gegevens heeft bijgewerkt of bevestigd.
-- Wie het vaakst bijdraagt, is de stamgast; zijn naam staat bovenaan de geschiedenis.
-- Zie docs/concept.md, paragraaf 3.1.
--
-- Een bijdrage is:
--   * een eigen melding die bevestigd is (eerst gemeld, gewijzigd of "klopt nog");
--   * een "klopt" van jou op een melding van een ander die daarna bevestigd is.
-- Openstaande en weerlegde meldingen tellen niet mee.
-- Gelijkspel: wie de stand het eerst bereikte, blijft stamgast; inhalen kan alleen door
-- er een meer te hebben.
-- Stamgast word je vanaf twee bijdragen; een enkele melding maakt nog geen vaste gast.

create or replace view public.kroeg_bijdragers
with (security_invoker = true)
as
with bijdrage as (
  select g.kroeg_id, g.door_id as gebruiker_id, g.op
  from public.gebeurtenissen g
  where g.status = 'bevestigd' and g.door_id is not null
  union all
  select g.kroeg_id, b.door_id as gebruiker_id, b.op
  from public.bevestigingen b
  join public.gebeurtenissen g on g.id = b.gebeurtenis_id
  where b.oordeel = 'klopt' and g.status = 'bevestigd' and b.door_id is not null
), per_speler as (
  select kroeg_id, gebruiker_id, count(*)::integer as bijdragen, min(op) as eerste, max(op) as laatst
  from bijdrage
  group by kroeg_id, gebruiker_id
)
select
  ps.kroeg_id,
  ps.gebruiker_id,
  p.naam,
  ps.bijdragen,
  ps.eerste,
  ps.laatst,
  (row_number() over (partition by ps.kroeg_id order by ps.bijdragen desc, ps.laatst asc, ps.gebruiker_id))::integer as plek
from per_speler ps
join public.profielen p on p.id = ps.gebruiker_id;

comment on view public.kroeg_bijdragers is
  'Per kroeg en speler: aantal bevestigde bijdragen (meldingen en klopt-oordelen) en plek. Plek 1 met minstens 2 bijdragen is de stamgast.';

create or replace view public.kroeg_stamgast
with (security_invoker = true)
as
select kroeg_id, gebruiker_id, naam, bijdragen, eerste, laatst
from public.kroeg_bijdragers
where plek = 1 and bijdragen >= 2;

comment on view public.kroeg_stamgast is 'De stamgast per kroeg: de speler met de meeste bijdragen, vanaf 2.';

grant select on public.kroeg_bijdragers, public.kroeg_stamgast to anon, authenticated;
