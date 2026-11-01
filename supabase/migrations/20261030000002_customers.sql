-- Customers: the saved customer list. A quotation's Customer box searches it and fills in the
-- details of the customer picked. Managed on the Customers page (add, edit, import / export Excel).
-- One row per customer name (case and spaces ignored), so an import updates instead of duplicating.

create table if not exists public.customers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(btrim(name)) between 1 and 160),
  contact_person text check (char_length(contact_person) <= 120),
  phone          text check (char_length(phone) <= 60),
  email          text check (char_length(email) <= 160),
  address        text check (char_length(address) <= 500),
  note           text check (char_length(note) <= 500),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists customers_name_key on public.customers (lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));

drop trigger if exists customers_touch on public.customers;
create trigger customers_touch before update on public.customers
  for each row execute function public.touch_updated_at();

alter table public.customers enable row level security;

drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers for select to authenticated using ((select public.is_active_user()));
drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers for insert to authenticated with check ((select public.can_edit()));
drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers for update to authenticated using ((select public.can_edit())) with check ((select public.can_edit()));
drop policy if exists customers_delete on public.customers;
create policy customers_delete on public.customers for delete to authenticated using ((select public.can_edit()));

grant select, insert, update, delete on public.customers to authenticated;
