-- Restaurants in de dataset: alleen een restaurant dat ook als café of kroeg werkt hoort erin. Een lezer van de
-- menukaart (tools/google-kroegen/restaurantfilter.py) geeft per restaurant een oordeel:
--   kroeg       blijft: losse drankkaart of borrelkaart, borrelhapjes, bar, of de keuken sluit eerder dan de zaak
--   twijfel     blijft, met een markering om na te lopen
--   restaurant  gaat eruit: een gangenkaart met drank als bijzaak. De kroeg wordt gesloten (de geschiedenis blijft)
alter table public.kroegen
  add column restaurant_oordeel text check (restaurant_oordeel in ('kroeg', 'twijfel', 'restaurant')),
  add column restaurant_reden text,
  add column restaurant_beoordeeld_op timestamptz;

comment on column public.kroegen.restaurant_oordeel is 'Oordeel van de menukaartlezer voor een restaurant: kroeg (blijft), twijfel (blijft, na te lopen) of restaurant (gesloten).';

-- Een kroeg die als restaurant is beoordeeld blijft dicht, ook als een import hem weer opent
-- (de OSM-import en de Google-koppeling zetten open opnieuw).
create or replace function private.restaurant_blijft_dicht()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.restaurant_oordeel = 'restaurant' then
    new.open := false;
  end if;
  return new;
end;
$$;

revoke all on function private.restaurant_blijft_dicht() from public, anon, authenticated;

create trigger kroegen_restaurant_blijft_dicht
  before insert or update on public.kroegen
  for each row execute function private.restaurant_blijft_dicht();

-- Zet de oordelen: [{ "kroeg_id": 1, "oordeel": "kroeg", "reden": "..." }]. Een kroeg die eerder als restaurant
-- dicht ging en nu "kroeg" of "twijfel" krijgt, gaat weer open, tenzij spelers hem sloten.
create or replace function private.zet_restaurantoordelen(p_oordelen jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
  n_eruit integer := 0;
begin
  for r in
    select (o ->> 'kroeg_id')::bigint as kroeg_id, o ->> 'oordeel' as oordeel, left(o ->> 'reden', 300) as reden
    from jsonb_array_elements(p_oordelen) o
  loop
    if r.oordeel not in ('kroeg', 'twijfel', 'restaurant') then
      raise exception 'Onbekend oordeel: %', r.oordeel;
    end if;
    update public.kroegen
    set restaurant_oordeel = r.oordeel,
        restaurant_reden = r.reden,
        restaurant_beoordeeld_op = now(),
        open = case
          when r.oordeel = 'restaurant' then false
          when restaurant_oordeel = 'restaurant' then not gesloten_door_spelers
          else open
        end
    where id = r.kroeg_id;
    if found then
      n := n + 1;
      if r.oordeel = 'restaurant' then n_eruit := n_eruit + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('bijgewerkt', n, 'gesloten', n_eruit);
end;
$$;

create or replace function public.zet_restaurantoordelen(p_oordelen jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.zet_restaurantoordelen(p_oordelen);
$$;

revoke all on function private.zet_restaurantoordelen(jsonb), public.zet_restaurantoordelen(jsonb) from public, anon, authenticated;
grant execute on function private.zet_restaurantoordelen(jsonb), public.zet_restaurantoordelen(jsonb) to service_role;
