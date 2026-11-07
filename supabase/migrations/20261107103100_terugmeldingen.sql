-- Terugmeldingen over de kroeg zelf (dicht, verkeerde plek, dubbel).
-- De prijs blijft via meld_prijs / beoordeel lopen. Alleen beheerders zien alles.

create table public.terugmeldingen (
  id bigint generated always as identity primary key,
  kroeg_id bigint not null references public.kroegen (id) on delete cascade,
  door_id uuid not null references public.profielen (id) on delete cascade,
  soort text not null check (soort in ('dicht', 'verkeerde_plek', 'duplicaat')),
  toelichting text check (toelichting is null or char_length(toelichting) <= 280),
  op timestamptz not null default now(),
  unique (kroeg_id, door_id, soort)
);

create index terugmeldingen_op_idx on public.terugmeldingen (op desc);
grant usage, select on sequence public.terugmeldingen_id_seq to authenticated;

alter table public.terugmeldingen enable row level security;
revoke all on public.terugmeldingen from anon, authenticated;
grant select, insert on public.terugmeldingen to authenticated;

create policy "eigen terugmelding of beheerder" on public.terugmeldingen
  for select to authenticated
  using (
    door_id = (select auth.uid())
    or exists (
      select 1 from public.profielen p
      where p.id = (select auth.uid()) and p.is_beheerder
    )
  );

create policy "eigen terugmelding plaatsen" on public.terugmeldingen
  for insert to authenticated
  with check (door_id = (select auth.uid()));
