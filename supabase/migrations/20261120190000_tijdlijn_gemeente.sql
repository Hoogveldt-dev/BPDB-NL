-- Stadskeuze: de gemeente van de kroeg op kroeg_tijdlijn.
--
-- De app laadt de koers (Pilsindex, lichtkrant, laatste meldingen) nu per stad. Zonder gemeente op de tijdlijn
-- zouden die alle steden door elkaar halen. De kolom staat achteraan, zodat bestaande kolommen gelijk blijven.

create or replace view public.kroeg_tijdlijn
with (security_invoker = true)
as
select
  g.id,
  g.kroeg_id,
  k.naam as kroeg,
  g.soort,
  g.status,
  g.merk,
  g.volume_cl,
  g.prijs_cent,
  g.vorige_prijs_cent,
  g.op,
  g.door_id,
  p.naam as door,
  g.ter_plaatse,
  g.foto_pad,
  g.uitschieter,
  coalesce(
    (select array_agg(bp.naam order by b.op)
     from public.bevestigingen b join public.profielen bp on bp.id = b.door_id
     where b.gebeurtenis_id = g.id and b.oordeel = 'klopt'), '{}') as bevestigd_door,
  coalesce(
    (select array_agg(bp.naam order by b.op)
     from public.bevestigingen b join public.profielen bp on bp.id = b.door_id
     where b.gebeurtenis_id = g.id and b.oordeel = 'klopt_niet'), '{}') as weerlegd_door,
  g.bron,
  g.bron_omschrijving,
  k.gemeente
from public.gebeurtenissen g
join public.kroegen k on k.id = g.kroeg_id
left join public.profielen p on p.id = g.door_id;
