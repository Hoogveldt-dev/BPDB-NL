-- BPDB-NL: "klopt nog" hoogstens een keer per week per kroeg, ook na een eigen melding of een "klopt"
-- Tot nu toe keek de weekgrens van klopt_nog alleen naar eerdere "klopt nog" van dezelfde speler. Wie een wachtende
-- melding bevestigde, kon direct daarna "klopt nog" doen: twee keer punten voor een bezoek. Nu weigert klopt_nog ook
-- als de speler bij deze kroeg in de afgelopen 7 dagen zelf een prijs meldde of "klopt" gaf op een melding.
-- Verder gelijk aan 20261106090000_anonieme_spelers.sql; de rechten blijven staan (create or replace).

create or replace function private.klopt_nog(
  p_kroeg_id bigint,
  p_lat double precision default null,
  p_lon double precision default null
)
returns public.gebeurtenissen
language plpgsql
security definer
set search_path = ''
as $$
declare
  ik uuid := auth.uid();
  k public.kroegen;
  g public.gebeurtenissen;
  afstand double precision;
  oud boolean;
  pt integer;
begin
  if ik is null then
    raise exception 'Log eerst in' using errcode = '28000';
  end if;
  perform private.vereis_email();
  select * into k from public.kroegen where id = p_kroeg_id for update;
  if not found then
    raise exception 'Kroeg bestaat niet' using errcode = 'P0002';
  end if;
  if k.huidig_prijs_cent is null then
    raise exception 'Deze kroeg heeft nog geen bevestigde prijs' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.gebeurtenissen where kroeg_id = k.id and status = 'wacht') then
    raise exception 'Er staat een melding open; beoordeel die in plaats van "Klopt nog"' using errcode = 'P0001';
  end if;
  -- Een controle per week per kroeg: ook een eigen melding of een "klopt" op een melding van een ander telt als
  -- controle (20261126110000_klopt_nog_na_bevestigen)
  if exists (select 1 from public.gebeurtenissen
             where kroeg_id = k.id and door_id = ik and op > now() - interval '7 days')
     or exists (select 1 from public.bevestigingen b
                join public.gebeurtenissen ge on ge.id = b.gebeurtenis_id
                where ge.kroeg_id = k.id and b.door_id = ik and b.oordeel = 'klopt' and b.op > now() - interval '7 days') then
    raise exception 'Je hebt deze kroeg deze week al gecontroleerd' using errcode = 'P0001';
  end if;

  if p_lat is not null and p_lon is not null then
    afstand := extensions.st_distance(
      k.locatie,
      extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography);
  end if;
  oud := coalesce(k.laatst_gecontroleerd, k.prijs_sinds) < now() - interval '90 days';

  insert into public.gebeurtenissen (
    kroeg_id, soort, merk, volume_cl, prijs_cent, door_id, ter_plaatse, afstand_m, status, afgerond_op)
  values (
    k.id, 'check', k.huidig_merk, k.huidig_volume_cl, k.huidig_prijs_cent, ik,
    coalesce(afstand <= 75, false), round(afstand), 'bevestigd', now())
  returning * into g;

  update public.kroegen set laatst_gecontroleerd = now() where id = k.id;

  pt := case when oud then 15 else 5 end;
  if g.ter_plaatse then
    pt := round(pt * 1.5);
  end if;
  perform private.geef_punten(ik, case when oud then 'oude_prijs_gecontroleerd' else 'klopt_nog' end, pt, g.id);
  return g;
end;
$$;
