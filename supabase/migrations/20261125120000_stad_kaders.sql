-- Kader per stad: het kleinste rechthoek om de open kroegen van een gemeente.
--
-- De app laadt alleen de steden die in beeld zijn (laadInBeeld() in app/app.js): met deze kaders ziet hij welke
-- steden het zichtbare deel van de kaart raken, zonder hun kroegen al op te halen. Klein, ook met honderden steden.

create view public.stad_kaders with (security_invoker = true) as
select k.gemeente,
       extensions.st_xmin(b) as west,
       extensions.st_ymin(b) as zuid,
       extensions.st_xmax(b) as oost,
       extensions.st_ymax(b) as noord
from (
  select gemeente, extensions.st_extent(locatie::extensions.geometry)::extensions.box3d as b
  from public.kroegen
  where open
  group by gemeente
) k;

comment on view public.stad_kaders is 'Rechthoek om de open kroegen per gemeente, om alleen de steden in beeld te laden.';
grant select on public.stad_kaders to anon, authenticated;
