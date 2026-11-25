-- Grens per stad voor de kaart: de wijken van een gemeente samengevoegd en vereenvoudigd (ongeveer 50 m).
--
-- De kaart toont de kroegen van alle steden. Pilsindex, lichtkrant en Beurs gaan over de stad die het meest van het
-- scherm vult; de app bepaalt die met deze grenzen (stadInBeeld() in app/app.js). Een gemeente zonder wijken heeft
-- geen grens; dan telt de app de kroegen in beeld.

create view public.stad_grenzen with (security_invoker = true) as
select w.gemeente,
       extensions.st_asgeojson(
         extensions.st_simplifypreservetopology(extensions.st_union(w.geometrie::extensions.geometry), 0.0005), 5
       )::jsonb as vlak
from public.wijken w
group by w.gemeente;

comment on view public.stad_grenzen is 'Vereenvoudigde grens per gemeente (samengevoegde wijken), voor de stad in beeld op de kaart.';
grant select on public.stad_grenzen to anon, authenticated;
