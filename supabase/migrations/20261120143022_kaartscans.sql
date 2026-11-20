-- Telt hoe vaak iemand via de QR-code op het terraskaartje binnenkomt.
-- Bewust zonder persoonsgegevens: alleen de bron en het tijdstip.

create table public.kaartscans (
  id   bigint generated always as identity primary key,
  bron text not null default 'kaartje' check (bron ~ '^[a-z0-9-]{1,32}$'),
  op   timestamptz not null default now()
);

comment on table public.kaartscans is 'Eén rij per bezoek via een gedrukte QR-code (bijvoorbeeld bierkoers.nl/k).';

alter table public.kaartscans enable row level security;

-- Iedereen mag een scan toevoegen, niemand mag via de API lezen, wijzigen of verwijderen.
-- Uitlezen gaat via de SQL Editor (die gebruikt de postgres-rol en negeert RLS).
revoke all on public.kaartscans from anon, authenticated;
grant insert (bron) on public.kaartscans to anon, authenticated;

create policy "scan toevoegen" on public.kaartscans
  for insert to anon, authenticated
  with check (true);
