-- BPDB-NL: stamgast telt bezoekdagen, niet losse tikken
-- Tot nu toe telde elke bijdrage apart. Wie bij een bezoek een openstaande melding
-- bevestigde en meteen daarna "klopt nog" deed, had er zo twee en was na een bezoek al
-- stamgast. Nu telt per speler en kroeg hoogstens een bijdrage per dag (Nederlandse tijd):
-- stamgast word je door er op minstens twee verschillende dagen de prijs bij te werken
-- of te bevestigen. Verder blijft alles gelijk aan 20261105220601_stamkroeg.sql.

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
), per_dag as (
  select kroeg_id, gebruiker_id, min(op) as begin_dag, max(op) as eind_dag
  from bijdrage
  group by kroeg_id, gebruiker_id, (op at time zone 'Europe/Amsterdam')::date
), per_speler as (
  -- bereikt: het moment van de eerste bijdrage op de laatste dag, dus wanneer de stand bereikt werd
  select kroeg_id, gebruiker_id, count(*)::integer as bijdragen,
    min(begin_dag) as eerste, max(eind_dag) as laatst, max(begin_dag) as bereikt
  from per_dag
  group by kroeg_id, gebruiker_id
)
select
  ps.kroeg_id,
  ps.gebruiker_id,
  p.naam,
  ps.bijdragen,
  ps.eerste,
  ps.laatst,
  (row_number() over (partition by ps.kroeg_id order by ps.bijdragen desc, ps.bereikt asc, ps.gebruiker_id))::integer as plek
from per_speler ps
join public.profielen p on p.id = ps.gebruiker_id;

comment on view public.kroeg_bijdragers is
  'Per kroeg en speler: aantal dagen met een bevestigde bijdrage (meldingen en klopt-oordelen) en plek. Plek 1 met minstens 2 is de stamgast.';
