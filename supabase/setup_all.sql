-- ONE-STEP SETUP for a NEW, EMPTY database: paste into Supabase -> SQL Editor -> Run.
-- Creates the tables + security, bill lines, the pipe size chart and your 202 inventory items.
-- (Already set up? Run only the newer files in supabase/migrations instead.)

begin;

-- =====================================================================
-- Quotation Panel - database schema
--
-- Run this once in Supabase (SQL Editor -> New query -> paste -> Run),
-- or with the Supabase CLI: `supabase db push`.
--
-- Security model
--   * Row Level Security is enabled on every table.
--   * Roles live in public.profiles (admin | editor | viewer) and are only
--     honoured while the profile is active.
--   * The anon role has no table or function access at all.
--   * Generated Excel/PDF files are never stored - only inventory and the
--     lightweight quotation data rows.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.app_role as enum ('admin', 'editor', 'viewer');
create type public.quotation_status as enum ('draft', 'sent', 'accepted', 'rejected', 'expired');

-- ---------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------
create or replace function public.set_audit_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Profiles (one row per auth user)
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null default '',
  full_name   text check (char_length(full_name) <= 120),
  role        public.app_role not null default 'viewer',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Role helpers. SECURITY DEFINER so policies can read profiles without
-- recursive RLS; they only ever look at the caller's own row.
create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid()) and p.is_active
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_app_role() is not null
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() = 'admin', false)
$$;

create or replace function public.can_edit()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() in ('admin', 'editor'), false)
$$;

-- New auth user -> profile. The very first user becomes admin; everyone
-- after that starts as a read-only viewer until an admin promotes them.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := 'viewer';
begin
  perform pg_advisory_xact_lock(hashtext('public.profiles.first_admin'));
  if not exists (select 1 from public.profiles) then
    v_role := 'admin';
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(left(trim(new.raw_user_meta_data ->> 'full_name'), 120), ''),
    v_role
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profile email in sync when a user changes it in Auth.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- Keep identity columns immutable, stop non-admins from changing their own
-- role/status, and never allow the last active admin to be demoted or
-- deactivated. (Direct SQL-editor sessions have no auth.uid() and are
-- trusted, so an owner can always recover access from the dashboard.)
create or replace function public.protect_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.id := old.id;
  new.email := old.email;
  new.created_at := old.created_at;
  new.updated_at := now();

  if (select auth.uid()) is not null and not public.is_admin() then
    new.role := old.role;
    new.is_active := old.is_active;
  end if;

  if old.role = 'admin' and old.is_active
     and (new.role <> 'admin' or not new.is_active) then
    if not exists (
      select 1 from public.profiles p
      where p.role = 'admin' and p.is_active and p.id <> old.id
    ) then
      raise exception 'At least one active admin is required'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_protect
  before update on public.profiles
  for each row execute function public.protect_profile();

-- Users that already existed before this migration get a profile too
-- (the oldest one becomes admin when there is no admin yet).
insert into public.profiles (id, email, role)
select
  u.id,
  coalesce(u.email, ''),
  case when row_number() over (order by u.created_at) = 1 then 'admin'::public.app_role
       else 'viewer'::public.app_role end
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Company settings (single row) - used on quotation headers
-- ---------------------------------------------------------------------
create table public.company_settings (
  id                     boolean primary key default true check (id),
  company_name           text not null default 'Your Company Name' check (char_length(company_name) between 1 and 120),
  tagline                text check (char_length(tagline) <= 160),
  address                text check (char_length(address) <= 500),
  phone                  text check (char_length(phone) <= 60),
  email                  text check (char_length(email) <= 120),
  website                text check (char_length(website) <= 120),
  tax_id                 text check (char_length(tax_id) <= 60),
  base_currency          text not null default 'CNY' check (base_currency ~ '^[A-Z]{3}$'),
  default_currency       text not null default 'CNY' check (default_currency ~ '^[A-Z]{3}$'),
  default_exchange_rate  numeric(14, 6) not null default 1 check (default_exchange_rate > 0),
  default_margin_pct     numeric(7, 2) not null default 0 check (default_margin_pct between -100 and 1000),
  default_tax_label      text not null default 'Tax' check (char_length(default_tax_label) between 1 and 30),
  default_tax_pct        numeric(6, 2) not null default 0 check (default_tax_pct between 0 and 100),
  default_validity_days  integer not null default 30 check (default_validity_days between 1 and 365),
  quote_prefix           text not null default 'QT' check (quote_prefix ~ '^[A-Z0-9-]{1,10}$'),
  default_terms          text check (char_length(default_terms) <= 4000),
  bank_details           text check (char_length(bank_details) <= 2000),
  footer_note            text check (char_length(footer_note) <= 300),
  updated_at             timestamptz not null default now()
);

insert into public.company_settings (id, default_terms)
values (
  true,
  E'1. Prices are valid until the date shown above.\n2. Payment: 30% advance, balance against documents.\n3. Delivery: within 30 days from confirmed order.\n4. Material as per ASME B16.9 / ASTM A234 WPB unless specified.'
)
on conflict (id) do nothing;

create trigger company_settings_touch
  before update on public.company_settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Pipe dimension chart (ANSI/ASME B36.10 & B36.19)
-- ---------------------------------------------------------------------
create table public.pipe_sizes (
  id          bigint generated by default as identity primary key,
  nps         text not null unique check (char_length(nps) between 1 and 16),
  nps_value   numeric(7, 3) not null unique check (nps_value > 0),
  dn          integer unique check (dn > 0 and dn < 10000),
  od_mm       numeric(8, 2) not null check (od_mm > 0 and od_mm < 10000),
  sch_5s      numeric(6, 2) check (sch_5s > 0),
  sch_10s     numeric(6, 2) check (sch_10s > 0),
  sch_10      numeric(6, 2) check (sch_10 > 0),
  sch_20      numeric(6, 2) check (sch_20 > 0),
  sch_30      numeric(6, 2) check (sch_30 > 0),
  sch_40s     numeric(6, 2) check (sch_40s > 0),
  sch_std     numeric(6, 2) check (sch_std > 0),
  sch_40      numeric(6, 2) check (sch_40 > 0),
  sch_60      numeric(6, 2) check (sch_60 > 0),
  sch_80s     numeric(6, 2) check (sch_80s > 0),
  sch_xs      numeric(6, 2) check (sch_xs > 0),
  sch_80      numeric(6, 2) check (sch_80 > 0),
  sch_100     numeric(6, 2) check (sch_100 > 0),
  sch_120     numeric(6, 2) check (sch_120 > 0),
  sch_140     numeric(6, 2) check (sch_140 > 0),
  sch_160     numeric(6, 2) check (sch_160 > 0),
  sch_xxs     numeric(6, 2) check (sch_xxs > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger pipe_sizes_touch
  before update on public.pipe_sizes
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------
create table public.inventory_items (
  id                 uuid primary key default gen_random_uuid(),
  seq                bigint generated always as identity,
  item_code          text check (char_length(item_code) <= 40),
  description        text not null check (char_length(description) between 1 and 200),
  category           text not null default 'Elbow 90°' check (char_length(category) between 1 and 60),
  nps                text check (char_length(nps) <= 16),
  dn                 integer check (dn > 0 and dn < 10000),
  od_mm              numeric(8, 2) check (od_mm > 0 and od_mm < 10000),
  branch_nps         text check (char_length(branch_nps) <= 16),
  branch_dn          integer check (branch_dn > 0 and branch_dn < 10000),
  branch_od_mm       numeric(8, 2) check (branch_od_mm > 0 and branch_od_mm < 10000),
  schedule           text check (char_length(schedule) <= 12),
  wall_thickness_mm  numeric(6, 2) check (wall_thickness_mm > 0 and wall_thickness_mm < 200),
  weight_kg          numeric(12, 3) check (weight_kg >= 0),
  unit_price         numeric(14, 2) check (unit_price >= 0),
  stock_qty          numeric(14, 2) not null default 0 check (stock_qty >= 0),
  unit               text not null default 'PCS' check (char_length(unit) between 1 and 12),
  note               text check (char_length(note) <= 300),
  total_weight_kg    numeric(18, 3) generated always as (round(coalesce(weight_kg, 0) * stock_qty, 3)) stored,
  total_amount       numeric(18, 2) generated always as (round(coalesce(unit_price, 0) * stock_qty, 2)) stored,
  search_text        text generated always as (
                       lower(
                         coalesce(item_code, '') || ' ' || description || ' ' || category || ' ' ||
                         coalesce(nps, '') || ' ' || coalesce(branch_nps, '') || ' ' || coalesce(note, '')
                       )
                     ) stored,
  created_by         uuid references auth.users (id) on delete set null,
  updated_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index inventory_items_category_idx on public.inventory_items (category);
create index inventory_items_nps_idx on public.inventory_items (nps);
create index inventory_items_branch_nps_idx on public.inventory_items (branch_nps);
create index inventory_items_code_idx on public.inventory_items (item_code);
create index inventory_items_created_idx on public.inventory_items (created_at);
create unique index inventory_items_seq_idx on public.inventory_items (seq);

create trigger inventory_items_audit
  before insert or update on public.inventory_items
  for each row execute function public.set_audit_fields();

-- ---------------------------------------------------------------------
-- Quotations
-- ---------------------------------------------------------------------
create table public.quotation_counters (
  year     integer primary key,
  last_no  integer not null
);

create table public.quotations (
  id                uuid primary key default gen_random_uuid(),
  quote_no          text not null unique,
  status            public.quotation_status not null default 'draft',
  quote_date        date not null default current_date,
  valid_until       date,
  reference         text check (char_length(reference) <= 120),
  customer_name     text not null check (char_length(customer_name) between 1 and 160),
  contact_person    text check (char_length(contact_person) <= 120),
  customer_email    text check (char_length(customer_email) <= 160),
  customer_phone    text check (char_length(customer_phone) <= 60),
  customer_address  text check (char_length(customer_address) <= 500),
  currency          text not null default 'CNY' check (currency ~ '^[A-Z]{3}$'),
  exchange_rate     numeric(14, 6) not null default 1 check (exchange_rate > 0),
  margin_pct        numeric(7, 2) not null default 0 check (margin_pct between -100 and 1000),
  pricing_basis     text not null default 'piece' check (pricing_basis in ('piece', 'kg')),
  rate_per_kg       numeric(14, 4) check (rate_per_kg >= 0),
  discount_pct      numeric(6, 2) not null default 0 check (discount_pct between 0 and 100),
  freight           numeric(14, 2) not null default 0 check (freight >= 0),
  other_charges     numeric(14, 2) not null default 0 check (other_charges >= 0),
  tax_label         text not null default 'Tax' check (char_length(tax_label) between 1 and 30),
  tax_pct           numeric(6, 2) not null default 0 check (tax_pct between 0 and 100),
  notes             text check (char_length(notes) <= 2000),
  terms             text check (char_length(terms) <= 4000),
  total_qty         numeric(16, 2) not null default 0,
  total_weight_kg   numeric(18, 3) not null default 0,
  subtotal          numeric(18, 2) not null default 0,
  discount_amount   numeric(18, 2) not null default 0,
  tax_amount        numeric(18, 2) not null default 0,
  grand_total       numeric(18, 2) not null default 0,
  prepared_by       text check (char_length(prepared_by) <= 160),
  search_text       text generated always as (
                      lower(quote_no || ' ' || customer_name || ' ' || coalesce(reference, '') || ' ' || coalesce(contact_person, ''))
                    ) stored,
  created_by        uuid references auth.users (id) on delete set null,
  updated_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (valid_until is null or valid_until >= quote_date)
);

create index quotations_created_idx on public.quotations (created_at desc);
create index quotations_status_idx on public.quotations (status);
create index quotations_created_by_idx on public.quotations (created_by);

create trigger quotations_audit
  before insert or update on public.quotations
  for each row execute function public.set_audit_fields();

-- Quotation numbers are always generated by the database: PREFIX-YYYY-0001.
create or replace function public.assign_quote_no()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year   integer;
  v_no     integer;
  v_prefix text;
begin
  if tg_op = 'UPDATE' then
    new.quote_no := old.quote_no;
    return new;
  end if;

  v_year := extract(year from coalesce(new.quote_date, current_date))::integer;

  insert into public.quotation_counters as c (year, last_no)
  values (v_year, 1)
  on conflict (year) do update set last_no = c.last_no + 1
  returning c.last_no into v_no;

  select s.quote_prefix into v_prefix from public.company_settings s where s.id;
  new.quote_no := coalesce(v_prefix, 'QT') || '-' || v_year || '-' || lpad(v_no::text, 4, '0');
  return new;
end;
$$;

create trigger quotations_quote_no
  before insert or update on public.quotations
  for each row execute function public.assign_quote_no();

create table public.quotation_items (
  id                 uuid primary key default gen_random_uuid(),
  quotation_id       uuid not null references public.quotations (id) on delete cascade,
  position           integer not null check (position > 0),
  inventory_item_id  uuid references public.inventory_items (id) on delete set null,
  item_code          text check (char_length(item_code) <= 40),
  description        text not null check (char_length(description) between 1 and 300),
  nps                text check (char_length(nps) <= 16),
  dn                 integer check (dn > 0 and dn < 10000),
  od_mm              numeric(8, 2) check (od_mm > 0 and od_mm < 10000),
  spec               text check (char_length(spec) <= 60),
  unit               text not null default 'PCS' check (char_length(unit) between 1 and 12),
  qty                numeric(14, 2) not null default 0 check (qty >= 0),
  unit_weight_kg     numeric(12, 3) check (unit_weight_kg >= 0),
  base_price         numeric(14, 4) check (base_price >= 0),
  unit_price         numeric(14, 2) not null default 0 check (unit_price >= 0),
  price_overridden   boolean not null default false,
  remarks            text check (char_length(remarks) <= 300),
  total_weight_kg    numeric(18, 3) generated always as (round(qty * coalesce(unit_weight_kg, 0), 3)) stored,
  amount             numeric(18, 2) generated always as (round(qty * unit_price, 2)) stored,
  unique (quotation_id, position)
);

create index quotation_items_quotation_idx on public.quotation_items (quotation_id);
create index quotation_items_inventory_idx on public.quotation_items (inventory_item_id);

create or replace function public.can_modify_quotation(p_quotation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.quotations q
    where q.id = p_quotation_id
      and (
        public.is_admin()
        or (public.can_edit() and q.created_by = (select auth.uid()))
      )
  )
$$;

-- Save a quotation header + all of its lines atomically and recompute the
-- stored totals on the server. SECURITY INVOKER, so every statement is
-- checked against the caller's RLS policies.
create or replace function public.save_quotation(p_id uuid, p_header jsonb, p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id       uuid;
  v_quote_no text;
begin
  if p_header is null or jsonb_typeof(p_header) <> 'object' then
    raise exception 'Invalid quotation header' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Invalid quotation items' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'A quotation can contain at most 500 lines' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.quotations as q (
      quote_no, prepared_by, status, quote_date, valid_until, reference, customer_name, contact_person,
      customer_email, customer_phone, customer_address, currency, exchange_rate, margin_pct,
      pricing_basis, rate_per_kg, discount_pct, freight, other_charges, tax_label, tax_pct,
      notes, terms
    )
    values (
      '',
      (select left(coalesce(nullif(p.full_name, ''), p.email), 160)
         from public.profiles p where p.id = (select auth.uid())),
      coalesce((p_header ->> 'status')::public.quotation_status, 'draft'),
      coalesce((p_header ->> 'quote_date')::date, current_date),
      (p_header ->> 'valid_until')::date,
      nullif(p_header ->> 'reference', ''),
      p_header ->> 'customer_name',
      nullif(p_header ->> 'contact_person', ''),
      nullif(p_header ->> 'customer_email', ''),
      nullif(p_header ->> 'customer_phone', ''),
      nullif(p_header ->> 'customer_address', ''),
      coalesce(p_header ->> 'currency', 'CNY'),
      coalesce((p_header ->> 'exchange_rate')::numeric, 1),
      coalesce((p_header ->> 'margin_pct')::numeric, 0),
      coalesce(p_header ->> 'pricing_basis', 'piece'),
      (p_header ->> 'rate_per_kg')::numeric,
      coalesce((p_header ->> 'discount_pct')::numeric, 0),
      coalesce((p_header ->> 'freight')::numeric, 0),
      coalesce((p_header ->> 'other_charges')::numeric, 0),
      coalesce(nullif(p_header ->> 'tax_label', ''), 'Tax'),
      coalesce((p_header ->> 'tax_pct')::numeric, 0),
      nullif(p_header ->> 'notes', ''),
      nullif(p_header ->> 'terms', '')
    )
    returning q.id, q.quote_no into v_id, v_quote_no;
  else
    update public.quotations as q set
      status           = coalesce((p_header ->> 'status')::public.quotation_status, q.status),
      quote_date       = coalesce((p_header ->> 'quote_date')::date, q.quote_date),
      valid_until      = (p_header ->> 'valid_until')::date,
      reference        = nullif(p_header ->> 'reference', ''),
      customer_name    = p_header ->> 'customer_name',
      contact_person   = nullif(p_header ->> 'contact_person', ''),
      customer_email   = nullif(p_header ->> 'customer_email', ''),
      customer_phone   = nullif(p_header ->> 'customer_phone', ''),
      customer_address = nullif(p_header ->> 'customer_address', ''),
      currency         = coalesce(p_header ->> 'currency', q.currency),
      exchange_rate    = coalesce((p_header ->> 'exchange_rate')::numeric, q.exchange_rate),
      margin_pct       = coalesce((p_header ->> 'margin_pct')::numeric, 0),
      pricing_basis    = coalesce(p_header ->> 'pricing_basis', 'piece'),
      rate_per_kg      = (p_header ->> 'rate_per_kg')::numeric,
      discount_pct     = coalesce((p_header ->> 'discount_pct')::numeric, 0),
      freight          = coalesce((p_header ->> 'freight')::numeric, 0),
      other_charges    = coalesce((p_header ->> 'other_charges')::numeric, 0),
      tax_label        = coalesce(nullif(p_header ->> 'tax_label', ''), 'Tax'),
      tax_pct          = coalesce((p_header ->> 'tax_pct')::numeric, 0),
      notes            = nullif(p_header ->> 'notes', ''),
      terms            = nullif(p_header ->> 'terms', '')
    where q.id = p_id
    returning q.id, q.quote_no into v_id, v_quote_no;

    if v_id is null then
      raise exception 'Quotation not found or you do not have permission to edit it'
        using errcode = '42501';
    end if;

    delete from public.quotation_items qi where qi.quotation_id = v_id;
  end if;

  insert into public.quotation_items (
    quotation_id, position, inventory_item_id, item_code, description, nps, dn, od_mm, spec,
    unit, qty, unit_weight_kg, base_price, unit_price, price_overridden, remarks
  )
  select
    v_id,
    e.ord::integer,
    (select ii.id from public.inventory_items ii
      where ii.id = nullif(e.item ->> 'inventory_item_id', '')::uuid),
    nullif(e.item ->> 'item_code', ''),
    e.item ->> 'description',
    nullif(e.item ->> 'nps', ''),
    (e.item ->> 'dn')::integer,
    (e.item ->> 'od_mm')::numeric,
    nullif(e.item ->> 'spec', ''),
    coalesce(nullif(e.item ->> 'unit', ''), 'PCS'),
    coalesce((e.item ->> 'qty')::numeric, 0),
    (e.item ->> 'unit_weight_kg')::numeric,
    (e.item ->> 'base_price')::numeric,
    coalesce((e.item ->> 'unit_price')::numeric, 0),
    coalesce((e.item ->> 'price_overridden')::boolean, false),
    nullif(e.item ->> 'remarks', '')
  from jsonb_array_elements(p_items) with ordinality as e (item, ord);

  with t as (
    select
      coalesce(sum(qi.qty), 0)             as tq,
      coalesce(sum(qi.total_weight_kg), 0) as tw,
      coalesce(sum(qi.amount), 0)          as st
    from public.quotation_items qi
    where qi.quotation_id = v_id
  ),
  c as (
    select
      t.tq, t.tw, t.st,
      round(t.st * q.discount_pct / 100, 2) as disc,
      q.freight, q.other_charges, q.tax_pct
    from t, public.quotations q
    where q.id = v_id
  )
  update public.quotations as q set
    total_qty       = c.tq,
    total_weight_kg = c.tw,
    subtotal        = c.st,
    discount_amount = c.disc,
    tax_amount      = round((c.st - c.disc + c.freight + c.other_charges) * c.tax_pct / 100, 2),
    grand_total     = (c.st - c.disc + c.freight + c.other_charges)
                      + round((c.st - c.disc + c.freight + c.other_charges) * c.tax_pct / 100, 2)
  from c
  where q.id = v_id;

  return jsonb_build_object('id', v_id, 'quote_no', v_quote_no);
end;
$$;

-- Dashboard figures, computed under the caller's RLS.
create or replace function public.dashboard_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'inventory', (
      select jsonb_build_object(
        'items', count(*),
        'total_qty', coalesce(sum(i.stock_qty), 0),
        'total_weight_kg', coalesce(sum(i.total_weight_kg), 0),
        'total_value', coalesce(sum(i.total_amount), 0),
        'low_stock', count(*) filter (where i.stock_qty <= 0)
      )
      from public.inventory_items i
    ),
    'categories', coalesce((
      select jsonb_agg(x order by x.value desc)
      from (
        select i.category, count(*) as items, coalesce(sum(i.total_amount), 0) as value
        from public.inventory_items i
        group by i.category
      ) x
    ), '[]'::jsonb),
    'quotations', (
      select jsonb_build_object(
        'total', count(*),
        'draft', count(*) filter (where q.status = 'draft'),
        'sent', count(*) filter (where q.status = 'sent'),
        'accepted', count(*) filter (where q.status = 'accepted'),
        'this_month', count(*) filter (where date_trunc('month', q.quote_date) = date_trunc('month', current_date))
      )
      from public.quotations q
    )
  )
$$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.company_settings    enable row level security;
alter table public.pipe_sizes          enable row level security;
alter table public.inventory_items     enable row level security;
alter table public.quotation_counters  enable row level security;
alter table public.quotations          enable row level security;
alter table public.quotation_items     enable row level security;

-- profiles: everyone sees their own row, admins see and manage all rows.
create policy "profiles_select_own_or_admin" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create policy "profiles_update_admin" on public.profiles
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Users may edit their own display name (role/status are pinned by the
-- protect_profile trigger).
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) and (select public.is_active_user()))
  with check (id = (select auth.uid()));

-- company settings: readable by active users, editable by admins.
create policy "company_settings_select" on public.company_settings
  for select to authenticated
  using ((select public.is_active_user()));

create policy "company_settings_update_admin" on public.company_settings
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- pipe sizes: readable by active users, maintained by admins.
create policy "pipe_sizes_select" on public.pipe_sizes
  for select to authenticated
  using ((select public.is_active_user()));

create policy "pipe_sizes_insert_admin" on public.pipe_sizes
  for insert to authenticated
  with check ((select public.is_admin()));

create policy "pipe_sizes_update_admin" on public.pipe_sizes
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "pipe_sizes_delete_admin" on public.pipe_sizes
  for delete to authenticated
  using ((select public.is_admin()));

-- inventory: readable by active users, editable by admins and editors.
create policy "inventory_select" on public.inventory_items
  for select to authenticated
  using ((select public.is_active_user()));

create policy "inventory_insert" on public.inventory_items
  for insert to authenticated
  with check ((select public.can_edit()));

create policy "inventory_update" on public.inventory_items
  for update to authenticated
  using ((select public.can_edit()))
  with check ((select public.can_edit()));

create policy "inventory_delete" on public.inventory_items
  for delete to authenticated
  using ((select public.can_edit()));

-- quotation_counters: no policies - only reachable through the
-- SECURITY DEFINER numbering trigger.

-- quotations: all active users can read; editors manage their own,
-- admins manage everything.
create policy "quotations_select" on public.quotations
  for select to authenticated
  using ((select public.is_active_user()));

create policy "quotations_insert" on public.quotations
  for insert to authenticated
  with check ((select public.can_edit()));

create policy "quotations_update" on public.quotations
  for update to authenticated
  using ((select public.is_admin()) or ((select public.can_edit()) and created_by = (select auth.uid())))
  with check ((select public.is_admin()) or ((select public.can_edit()) and created_by = (select auth.uid())));

create policy "quotations_delete" on public.quotations
  for delete to authenticated
  using ((select public.is_admin()) or ((select public.can_edit()) and created_by = (select auth.uid())));

create policy "quotation_items_select" on public.quotation_items
  for select to authenticated
  using ((select public.is_active_user()));

create policy "quotation_items_insert" on public.quotation_items
  for insert to authenticated
  with check (public.can_modify_quotation(quotation_id));

create policy "quotation_items_update" on public.quotation_items
  for update to authenticated
  using (public.can_modify_quotation(quotation_id))
  with check (public.can_modify_quotation(quotation_id));

create policy "quotation_items_delete" on public.quotation_items
  for delete to authenticated
  using (public.can_modify_quotation(quotation_id));

-- ---------------------------------------------------------------------
-- Privileges: nothing for anon, least privilege for authenticated.
-- ---------------------------------------------------------------------
-- Supabase grants ALL (incl. TRUNCATE, which bypasses RLS) by default, so
-- start from nothing and grant only what the policies need.
revoke all on public.profiles, public.company_settings, public.pipe_sizes,
  public.inventory_items, public.quotation_counters, public.quotations,
  public.quotation_items
from anon, authenticated, public;

grant select, update on public.profiles to authenticated;
grant select, update on public.company_settings to authenticated;
grant select, insert, update, delete on public.pipe_sizes to authenticated;
grant select, insert, update, delete on public.inventory_items to authenticated;
grant select, insert, update, delete on public.quotations to authenticated;
grant select, insert, update, delete on public.quotation_items to authenticated;

revoke execute on function
  public.current_app_role(), public.is_active_user(), public.is_admin(), public.can_edit(),
  public.can_modify_quotation(uuid), public.save_quotation(uuid, jsonb, jsonb),
  public.dashboard_summary(), public.handle_new_user(), public.handle_user_email_change(),
  public.protect_profile(), public.assign_quote_no(), public.set_audit_fields(),
  public.touch_updated_at()
from anon, public;

grant execute on function
  public.current_app_role(), public.is_active_user(), public.is_admin(), public.can_edit(),
  public.can_modify_quotation(uuid), public.save_quotation(uuid, jsonb, jsonb),
  public.dashboard_summary()
to authenticated;


-- Pipe dimension chart (ANSI/ASME B36.10 & B36.19). Generated by scripts/generate-seed.ts.
-- Safe to re-run: existing sizes are updated in place.
insert into public.pipe_sizes (nps, nps_value, dn, od_mm, sch_5s, sch_10s, sch_10, sch_20, sch_30, sch_40s, sch_std, sch_40, sch_60, sch_80s, sch_xs, sch_80, sch_100, sch_120, sch_140, sch_160, sch_xxs)
values
  ('1/8', 0.125, 6, 10.3, null, 1.24, null, null, null, 1.73, 1.73, 1.73, null, 2.41, 2.41, 2.41, null, null, null, null, null),
  ('1/4', 0.25, 8, 13.7, null, 1.65, null, null, null, 2.24, 2.24, 2.24, null, 3.02, 3.02, 3.02, null, null, null, null, null),
  ('3/8', 0.375, 10, 17.1, null, 1.65, null, null, null, 2.31, 2.31, 2.31, null, 3.2, 3.2, 3.2, null, null, null, null, null),
  ('1/2', 0.5, 15, 21.3, 1.65, 2.11, null, null, null, 2.77, 2.77, 2.77, null, 3.73, 3.73, 3.73, null, null, null, 4.78, 7.47),
  ('3/4', 0.75, 20, 26.7, 1.65, 2.11, null, null, null, 2.87, 2.87, 2.87, null, 3.91, 3.91, 3.91, null, null, null, 5.56, 7.82),
  ('1', 1, 25, 33.4, 1.65, 2.77, null, null, null, 3.38, 3.38, 3.38, null, 4.55, 4.55, 4.55, null, null, null, 6.35, 9.09),
  ('1 1/4', 1.25, 32, 42.2, 1.65, 2.77, null, null, null, 3.56, 3.56, 3.56, null, 4.85, 4.85, 4.85, null, null, null, 6.35, 9.7),
  ('1 1/2', 1.5, 40, 48.3, 1.65, 2.77, null, null, null, 3.68, 3.68, 3.68, null, 5.08, 5.08, 5.08, null, null, null, 7.14, 10.15),
  ('2', 2, 50, 60.3, 1.65, 2.77, null, null, null, 3.91, 3.91, 3.91, null, 5.54, 5.54, 5.54, null, null, null, 8.74, 11.07),
  ('2 1/2', 2.5, 65, 73, 2.11, 3.05, null, null, null, 5.16, 5.16, 5.16, null, 7.01, 7.01, 7.01, null, null, null, 9.53, 14.02),
  ('3', 3, 80, 88.9, 2.11, 3.05, null, null, null, 5.49, 5.49, 5.49, null, 7.62, 7.62, 7.62, null, null, null, 11.13, 15.24),
  ('3 1/2', 3.5, 90, 101.6, 2.11, 3.05, null, null, null, 5.74, 5.74, 5.74, null, 8.08, 8.08, 8.08, null, null, null, null, null),
  ('4', 4, 100, 114.3, 2.11, 3.05, null, null, null, 6.02, 6.02, 6.02, null, 8.56, 8.56, 8.56, null, 11.13, null, 13.49, 17.12),
  ('5', 5, 125, 141.3, 2.77, 3.4, null, null, null, 6.55, 6.55, 6.55, null, 9.53, 9.53, 9.53, null, 12.7, null, 15.88, 19.05),
  ('6', 6, 150, 168.3, 2.77, 3.4, null, null, null, 7.11, 7.11, 7.11, null, 10.97, 10.97, 10.97, null, 14.27, null, 18.26, 21.95),
  ('8', 8, 200, 219.1, 2.77, 3.76, null, 6.35, 7.04, 8.18, 8.18, 8.18, 10.31, 12.7, 12.7, 12.7, 15.09, 18.26, 20.62, 23.01, 22.23),
  ('10', 10, 250, 273.1, 3.4, 4.19, null, 6.35, 7.8, 9.27, 9.27, 9.27, 12.7, 12.7, 12.7, 15.09, 18.26, 21.44, 25.4, 28.58, 25.4),
  ('12', 12, 300, 323.9, 3.96, 4.57, null, 6.35, 8.38, 9.53, 9.53, 10.31, 14.27, 12.7, 12.7, 17.48, 21.44, 25.4, 28.58, 33.32, 25.4),
  ('14', 14, 350, 355.6, 3.96, 4.78, 6.35, 7.92, 9.53, null, 9.53, 11.13, 15.09, null, 12.7, 19.05, 23.83, 27.79, 31.75, 35.71, null),
  ('16', 16, 400, 406.4, 4.19, 4.78, 6.35, 7.92, 9.53, null, 9.53, 12.7, 16.66, null, 12.7, 21.44, 26.19, 30.96, 36.53, 40.49, null),
  ('18', 18, 450, 457.2, 4.19, 4.78, 6.35, 7.92, 11.13, null, 9.53, 14.27, 19.05, null, 12.7, 23.83, 29.36, 34.93, 39.67, 45.24, null),
  ('20', 20, 500, 508, 4.78, 5.54, 6.35, 9.53, 12.7, null, 9.53, 15.09, 20.62, null, 12.7, 26.19, 32.54, 38.1, 44.45, 50.01, null),
  ('22', 22, 550, 559, 4.78, 5.54, 6.35, 9.53, 12.7, null, 9.53, null, 22.23, null, 12.7, 28.58, 34.93, 41.28, 47.63, 53.98, null),
  ('24', 24, 600, 610, 5.54, 6.35, 6.35, 9.53, 14.27, null, 9.53, 17.48, 24.61, null, 12.7, 30.96, 38.89, 46.02, 52.37, 59.54, null),
  ('26', 26, 650, 660, null, null, 7.92, 12.7, null, null, 9.53, null, null, null, 12.7, null, null, null, null, null, null),
  ('28', 28, 700, 711, null, null, 7.92, 12.7, 15.88, null, 9.53, null, null, null, 12.7, null, null, null, null, null, null),
  ('30', 30, 750, 762, 6.35, 7.92, 7.92, 12.7, 15.88, null, 9.53, null, null, null, 12.7, null, null, null, null, null, null),
  ('32', 32, 800, 813, null, null, 7.92, 12.7, 15.88, null, 9.53, 17.48, null, null, 12.7, null, null, null, null, null, null),
  ('34', 34, 850, 864, null, null, 7.92, 12.7, 15.88, null, 9.53, 17.48, null, null, 12.7, null, null, null, null, null, null),
  ('36', 36, 900, 914, null, null, 7.92, 12.7, 15.88, null, 9.53, 19.05, null, null, 12.7, null, null, null, null, null, null),
  ('38', 38, 950, 965, null, null, null, null, null, null, 9.53, null, null, null, 12.7, null, null, null, null, null, null),
  ('40', 40, 1000, 1016, null, null, null, null, null, null, 9.53, null, null, null, 12.7, null, null, null, null, null, null),
  ('42', 42, 1050, 1067, null, null, null, 12.7, 15.88, null, 9.53, 19.05, null, null, 12.7, null, null, null, null, null, null),
  ('44', 44, 1100, 1118, null, null, null, null, null, null, 9.53, null, null, null, 12.7, null, null, null, null, null, null),
  ('46', 46, 1150, 1168, null, null, null, null, null, null, 9.53, null, null, null, 12.7, null, null, null, null, null, null),
  ('48', 48, 1200, 1219, null, null, null, null, null, null, 9.53, null, null, null, 12.7, null, null, null, null, null, null),
  ('52', 52, 1300, 1321, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null),
  ('56', 56, 1400, 1422, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null),
  ('60', 60, 1500, 1524, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null)
on conflict (nps) do update set
  nps_value = excluded.nps_value,
  dn = excluded.dn,
  od_mm = excluded.od_mm,
  sch_5s = excluded.sch_5s,
  sch_10s = excluded.sch_10s,
  sch_10 = excluded.sch_10,
  sch_20 = excluded.sch_20,
  sch_30 = excluded.sch_30,
  sch_40s = excluded.sch_40s,
  sch_std = excluded.sch_std,
  sch_40 = excluded.sch_40,
  sch_60 = excluded.sch_60,
  sch_80s = excluded.sch_80s,
  sch_xs = excluded.sch_xs,
  sch_80 = excluded.sch_80,
  sch_100 = excluded.sch_100,
  sch_120 = excluded.sch_120,
  sch_140 = excluded.sch_140,
  sch_160 = excluded.sch_160,
  sch_xxs = excluded.sch_xxs;


-- Bill lines: any number of discounts, charges and taxes per quotation,
-- each as a percentage or a fixed amount. Replaces the fixed
-- discount / freight / other charges / tax fields.
--
-- Run once in Supabase -> SQL Editor (after the first two migrations).

alter table public.quotations
  add column if not exists adjustments jsonb not null default '[]'::jsonb
    check (jsonb_typeof(adjustments) = 'array' and jsonb_array_length(adjustments) <= 20),
  add column if not exists charges_amount numeric(18, 2) not null default 0;

-- Carry existing quotations over to the new format.
update public.quotations q set adjustments = coalesce((
  select jsonb_agg(x.line order by x.ord)
  from (
    select 1 as ord, jsonb_build_object('kind', 'discount', 'label', 'Discount', 'mode', 'percent', 'value', q.discount_pct) as line where q.discount_pct > 0
    union all
    select 2, jsonb_build_object('kind', 'charge', 'label', 'Freight / packing', 'mode', 'amount', 'value', q.freight) where q.freight > 0
    union all
    select 3, jsonb_build_object('kind', 'charge', 'label', 'Other charges', 'mode', 'amount', 'value', q.other_charges) where q.other_charges > 0
    union all
    select 4, jsonb_build_object('kind', 'tax', 'label', q.tax_label, 'mode', 'percent', 'value', q.tax_pct) where q.tax_pct > 0
  ) x
), '[]'::jsonb),
charges_amount = q.freight + q.other_charges
where q.adjustments = '[]'::jsonb;

-- Same signature as before; now reads p_header->'adjustments' and computes
-- all totals on the server.
create or replace function public.save_quotation(p_id uuid, p_header jsonb, p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id       uuid;
  v_quote_no text;
  v_adj_in   jsonb;
  v_adj      jsonb;
  v_st       numeric;
  v_tq       numeric;
  v_tw       numeric;
  v_disc     numeric;
  v_chg      numeric;
  v_taxable  numeric;
  v_tax      numeric;
begin
  if p_header is null or jsonb_typeof(p_header) <> 'object' then
    raise exception 'Invalid quotation header' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Invalid quotation items' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'A quotation can contain at most 500 lines' using errcode = '22023';
  end if;

  -- Validate and normalise the bill lines.
  v_adj_in := coalesce(p_header -> 'adjustments', '[]'::jsonb);
  if jsonb_typeof(v_adj_in) <> 'array' or jsonb_array_length(v_adj_in) > 20 then
    raise exception 'Invalid bill lines' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_adj_in) a
    where case
      when jsonb_typeof(a) <> 'object' then true
      when coalesce(a ->> 'kind', '') not in ('discount', 'charge', 'tax') then true
      when coalesce(a ->> 'mode', '') not in ('percent', 'amount') then true
      when jsonb_typeof(a -> 'value') <> 'number' then true
      when (a ->> 'value')::numeric < 0 or (a ->> 'value')::numeric > 100000000000 then true
      when a ->> 'mode' = 'percent' and (a ->> 'value')::numeric > 100 then true
      when char_length(coalesce(a ->> 'label', '')) > 40 then true
      else false
    end
  ) then
    raise exception 'Invalid bill line' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', e.a ->> 'kind',
           'label', coalesce(nullif(trim(e.a ->> 'label'), ''),
                             case e.a ->> 'kind' when 'discount' then 'Discount' when 'tax' then 'Tax' else 'Charges' end),
           'mode', e.a ->> 'mode',
           'value', round((e.a ->> 'value')::numeric, 4)
         ) order by e.ord), '[]'::jsonb)
    into v_adj
  from jsonb_array_elements(v_adj_in) with ordinality as e (a, ord);

  if p_id is null then
    insert into public.quotations as q (
      quote_no, prepared_by, status, quote_date, valid_until, reference, customer_name, contact_person,
      customer_email, customer_phone, customer_address, currency, exchange_rate, margin_pct,
      pricing_basis, rate_per_kg, adjustments, notes, terms
    )
    values (
      '',
      (select left(coalesce(nullif(p.full_name, ''), p.email), 160)
         from public.profiles p where p.id = (select auth.uid())),
      coalesce((p_header ->> 'status')::public.quotation_status, 'draft'),
      coalesce((p_header ->> 'quote_date')::date, current_date),
      (p_header ->> 'valid_until')::date,
      nullif(p_header ->> 'reference', ''),
      p_header ->> 'customer_name',
      nullif(p_header ->> 'contact_person', ''),
      nullif(p_header ->> 'customer_email', ''),
      nullif(p_header ->> 'customer_phone', ''),
      nullif(p_header ->> 'customer_address', ''),
      coalesce(p_header ->> 'currency', 'CNY'),
      coalesce((p_header ->> 'exchange_rate')::numeric, 1),
      coalesce((p_header ->> 'margin_pct')::numeric, 0),
      coalesce(p_header ->> 'pricing_basis', 'piece'),
      (p_header ->> 'rate_per_kg')::numeric,
      v_adj,
      nullif(p_header ->> 'notes', ''),
      nullif(p_header ->> 'terms', '')
    )
    returning q.id, q.quote_no into v_id, v_quote_no;
  else
    update public.quotations as q set
      status           = coalesce((p_header ->> 'status')::public.quotation_status, q.status),
      quote_date       = coalesce((p_header ->> 'quote_date')::date, q.quote_date),
      valid_until      = (p_header ->> 'valid_until')::date,
      reference        = nullif(p_header ->> 'reference', ''),
      customer_name    = p_header ->> 'customer_name',
      contact_person   = nullif(p_header ->> 'contact_person', ''),
      customer_email   = nullif(p_header ->> 'customer_email', ''),
      customer_phone   = nullif(p_header ->> 'customer_phone', ''),
      customer_address = nullif(p_header ->> 'customer_address', ''),
      currency         = coalesce(p_header ->> 'currency', q.currency),
      exchange_rate    = coalesce((p_header ->> 'exchange_rate')::numeric, q.exchange_rate),
      margin_pct       = coalesce((p_header ->> 'margin_pct')::numeric, 0),
      pricing_basis    = coalesce(p_header ->> 'pricing_basis', 'piece'),
      rate_per_kg      = (p_header ->> 'rate_per_kg')::numeric,
      adjustments      = v_adj,
      discount_pct     = 0,
      freight          = 0,
      other_charges    = 0,
      tax_pct          = 0,
      notes            = nullif(p_header ->> 'notes', ''),
      terms            = nullif(p_header ->> 'terms', '')
    where q.id = p_id
    returning q.id, q.quote_no into v_id, v_quote_no;

    if v_id is null then
      raise exception 'Quotation not found or you do not have permission to edit it'
        using errcode = '42501';
    end if;

    delete from public.quotation_items qi where qi.quotation_id = v_id;
  end if;

  insert into public.quotation_items (
    quotation_id, position, inventory_item_id, item_code, description, nps, dn, od_mm, spec,
    unit, qty, unit_weight_kg, base_price, unit_price, price_overridden, remarks
  )
  select
    v_id,
    e.ord::integer,
    (select ii.id from public.inventory_items ii
      where ii.id = nullif(e.item ->> 'inventory_item_id', '')::uuid),
    nullif(e.item ->> 'item_code', ''),
    e.item ->> 'description',
    nullif(e.item ->> 'nps', ''),
    (e.item ->> 'dn')::integer,
    (e.item ->> 'od_mm')::numeric,
    nullif(e.item ->> 'spec', ''),
    coalesce(nullif(e.item ->> 'unit', ''), 'PCS'),
    coalesce((e.item ->> 'qty')::numeric, 0),
    (e.item ->> 'unit_weight_kg')::numeric,
    (e.item ->> 'base_price')::numeric,
    coalesce((e.item ->> 'unit_price')::numeric, 0),
    coalesce((e.item ->> 'price_overridden')::boolean, false),
    nullif(e.item ->> 'remarks', '')
  from jsonb_array_elements(p_items) with ordinality as e (item, ord);

  -- Totals: subtotal -> discounts -> charges -> taxes (on the taxable amount).
  select coalesce(sum(qi.qty), 0), coalesce(sum(qi.total_weight_kg), 0), coalesce(sum(qi.amount), 0)
    into v_tq, v_tw, v_st
  from public.quotation_items qi
  where qi.quotation_id = v_id;

  select coalesce(sum(case when a ->> 'mode' = 'percent' then round(v_st * (a ->> 'value')::numeric / 100, 2)
                           else round((a ->> 'value')::numeric, 2) end), 0)
    into v_disc
  from jsonb_array_elements(v_adj) a where a ->> 'kind' = 'discount';

  select coalesce(sum(case when a ->> 'mode' = 'percent' then round(v_st * (a ->> 'value')::numeric / 100, 2)
                           else round((a ->> 'value')::numeric, 2) end), 0)
    into v_chg
  from jsonb_array_elements(v_adj) a where a ->> 'kind' = 'charge';

  v_taxable := v_st - v_disc + v_chg;

  select coalesce(sum(case when a ->> 'mode' = 'percent' then round(v_taxable * (a ->> 'value')::numeric / 100, 2)
                           else round((a ->> 'value')::numeric, 2) end), 0)
    into v_tax
  from jsonb_array_elements(v_adj) a where a ->> 'kind' = 'tax';

  update public.quotations as q set
    total_qty       = v_tq,
    total_weight_kg = v_tw,
    subtotal        = v_st,
    discount_amount = v_disc,
    charges_amount  = v_chg,
    tax_amount      = v_tax,
    grand_total     = v_taxable + v_tax
  where q.id = v_id;

  return jsonb_build_object('id', v_id, 'quote_no', v_quote_no);
end;
$$;

revoke execute on function public.save_quotation(uuid, jsonb, jsonb) from anon, public;
grant execute on function public.save_quotation(uuid, jsonb, jsonb) to authenticated;


-- Inventory keeps only the columns from the supplier Excel:
-- ITEMS NO., ITEMS, WT IN KGS, RMB/PCS, QTY, (TOTAL KG), (AMOUNT), NOTE.
-- Removes the size / schedule / category columns from inventory and the
-- size columns from quotation lines. THIS DELETES THAT DATA.
--
-- Run once in Supabase -> SQL Editor, AFTER 20261020000001_bill_lines.sql.

-- The search column is generated from columns that are being removed.
alter table public.inventory_items drop column if exists search_text;

alter table public.inventory_items
  drop column if exists category,
  drop column if exists nps,
  drop column if exists dn,
  drop column if exists od_mm,
  drop column if exists branch_nps,
  drop column if exists branch_dn,
  drop column if exists branch_od_mm,
  drop column if exists schedule,
  drop column if exists wall_thickness_mm;

alter table public.inventory_items
  add column search_text text generated always as (
    lower(coalesce(item_code, '') || ' ' || description || ' ' || coalesce(note, ''))
  ) stored;

alter table public.quotation_items
  drop column if exists nps,
  drop column if exists dn,
  drop column if exists od_mm,
  drop column if exists spec;

-- Dashboard: no category breakdown any more.
create or replace function public.dashboard_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'inventory', (
      select jsonb_build_object(
        'items', count(*),
        'total_qty', coalesce(sum(i.stock_qty), 0),
        'total_weight_kg', coalesce(sum(i.total_weight_kg), 0),
        'total_value', coalesce(sum(i.total_amount), 0),
        'low_stock', count(*) filter (where i.stock_qty <= 0)
      )
      from public.inventory_items i
    ),
    'quotations', (
      select jsonb_build_object(
        'total', count(*),
        'draft', count(*) filter (where q.status = 'draft'),
        'sent', count(*) filter (where q.status = 'sent'),
        'accepted', count(*) filter (where q.status = 'accepted'),
        'this_month', count(*) filter (where date_trunc('month', q.quote_date) = date_trunc('month', current_date))
      )
      from public.quotations q
    )
  )
$$;

-- Saving quotations: same as before, without the size columns.
create or replace function public.save_quotation(p_id uuid, p_header jsonb, p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id       uuid;
  v_quote_no text;
  v_adj_in   jsonb;
  v_adj      jsonb;
  v_st       numeric;
  v_tq       numeric;
  v_tw       numeric;
  v_disc     numeric;
  v_chg      numeric;
  v_taxable  numeric;
  v_tax      numeric;
begin
  if p_header is null or jsonb_typeof(p_header) <> 'object' then
    raise exception 'Invalid quotation header' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Invalid quotation items' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'A quotation can contain at most 500 lines' using errcode = '22023';
  end if;

  -- Validate and normalise the bill lines.
  v_adj_in := coalesce(p_header -> 'adjustments', '[]'::jsonb);
  if jsonb_typeof(v_adj_in) <> 'array' or jsonb_array_length(v_adj_in) > 20 then
    raise exception 'Invalid bill lines' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_adj_in) a
    where case
      when jsonb_typeof(a) <> 'object' then true
      when coalesce(a ->> 'kind', '') not in ('discount', 'charge', 'tax') then true
      when coalesce(a ->> 'mode', '') not in ('percent', 'amount') then true
      when jsonb_typeof(a -> 'value') <> 'number' then true
      when (a ->> 'value')::numeric < 0 or (a ->> 'value')::numeric > 100000000000 then true
      when a ->> 'mode' = 'percent' and (a ->> 'value')::numeric > 100 then true
      when char_length(coalesce(a ->> 'label', '')) > 40 then true
      else false
    end
  ) then
    raise exception 'Invalid bill line' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', e.a ->> 'kind',
           'label', coalesce(nullif(trim(e.a ->> 'label'), ''),
                             case e.a ->> 'kind' when 'discount' then 'Discount' when 'tax' then 'Tax' else 'Charges' end),
           'mode', e.a ->> 'mode',
           'value', round((e.a ->> 'value')::numeric, 4)
         ) order by e.ord), '[]'::jsonb)
    into v_adj
  from jsonb_array_elements(v_adj_in) with ordinality as e (a, ord);

  if p_id is null then
    insert into public.quotations as q (
      quote_no, prepared_by, status, quote_date, valid_until, reference, customer_name, contact_person,
      customer_email, customer_phone, customer_address, currency, exchange_rate, margin_pct,
      pricing_basis, rate_per_kg, adjustments, notes, terms
    )
    values (
      '',
      (select left(coalesce(nullif(p.full_name, ''), p.email), 160)
         from public.profiles p where p.id = (select auth.uid())),
      coalesce((p_header ->> 'status')::public.quotation_status, 'draft'),
      coalesce((p_header ->> 'quote_date')::date, current_date),
      (p_header ->> 'valid_until')::date,
      nullif(p_header ->> 'reference', ''),
      p_header ->> 'customer_name',
      nullif(p_header ->> 'contact_person', ''),
      nullif(p_header ->> 'customer_email', ''),
      nullif(p_header ->> 'customer_phone', ''),
      nullif(p_header ->> 'customer_address', ''),
      coalesce(p_header ->> 'currency', 'CNY'),
      coalesce((p_header ->> 'exchange_rate')::numeric, 1),
      coalesce((p_header ->> 'margin_pct')::numeric, 0),
      coalesce(p_header ->> 'pricing_basis', 'piece'),
      (p_header ->> 'rate_per_kg')::numeric,
      v_adj,
      nullif(p_header ->> 'notes', ''),
      nullif(p_header ->> 'terms', '')
    )
    returning q.id, q.quote_no into v_id, v_quote_no;
  else
    update public.quotations as q set
      status           = coalesce((p_header ->> 'status')::public.quotation_status, q.status),
      quote_date       = coalesce((p_header ->> 'quote_date')::date, q.quote_date),
      valid_until      = (p_header ->> 'valid_until')::date,
      reference        = nullif(p_header ->> 'reference', ''),
      customer_name    = p_header ->> 'customer_name',
      contact_person   = nullif(p_header ->> 'contact_person', ''),
      customer_email   = nullif(p_header ->> 'customer_email', ''),
      customer_phone   = nullif(p_header ->> 'customer_phone', ''),
      customer_address = nullif(p_header ->> 'customer_address', ''),
      currency         = coalesce(p_header ->> 'currency', q.currency),
      exchange_rate    = coalesce((p_header ->> 'exchange_rate')::numeric, q.exchange_rate),
      margin_pct       = coalesce((p_header ->> 'margin_pct')::numeric, 0),
      pricing_basis    = coalesce(p_header ->> 'pricing_basis', 'piece'),
      rate_per_kg      = (p_header ->> 'rate_per_kg')::numeric,
      adjustments      = v_adj,
      discount_pct     = 0,
      freight          = 0,
      other_charges    = 0,
      tax_pct          = 0,
      notes            = nullif(p_header ->> 'notes', ''),
      terms            = nullif(p_header ->> 'terms', '')
    where q.id = p_id
    returning q.id, q.quote_no into v_id, v_quote_no;

    if v_id is null then
      raise exception 'Quotation not found or you do not have permission to edit it'
        using errcode = '42501';
    end if;

    delete from public.quotation_items qi where qi.quotation_id = v_id;
  end if;

  insert into public.quotation_items (
    quotation_id, position, inventory_item_id, item_code, description,
    unit, qty, unit_weight_kg, base_price, unit_price, price_overridden, remarks
  )
  select
    v_id,
    e.ord::integer,
    (select ii.id from public.inventory_items ii
      where ii.id = nullif(e.item ->> 'inventory_item_id', '')::uuid),
    nullif(e.item ->> 'item_code', ''),
    e.item ->> 'description',
    coalesce(nullif(e.item ->> 'unit', ''), 'PCS'),
    coalesce((e.item ->> 'qty')::numeric, 0),
    (e.item ->> 'unit_weight_kg')::numeric,
    (e.item ->> 'base_price')::numeric,
    coalesce((e.item ->> 'unit_price')::numeric, 0),
    coalesce((e.item ->> 'price_overridden')::boolean, false),
    nullif(e.item ->> 'remarks', '')
  from jsonb_array_elements(p_items) with ordinality as e (item, ord);

  -- Totals: subtotal -> discounts -> charges -> taxes (on the taxable amount).
  select coalesce(sum(qi.qty), 0), coalesce(sum(qi.total_weight_kg), 0), coalesce(sum(qi.amount), 0)
    into v_tq, v_tw, v_st
  from public.quotation_items qi
  where qi.quotation_id = v_id;

  select coalesce(sum(case when a ->> 'mode' = 'percent' then round(v_st * (a ->> 'value')::numeric / 100, 2)
                           else round((a ->> 'value')::numeric, 2) end), 0)
    into v_disc
  from jsonb_array_elements(v_adj) a where a ->> 'kind' = 'discount';

  select coalesce(sum(case when a ->> 'mode' = 'percent' then round(v_st * (a ->> 'value')::numeric / 100, 2)
                           else round((a ->> 'value')::numeric, 2) end), 0)
    into v_chg
  from jsonb_array_elements(v_adj) a where a ->> 'kind' = 'charge';

  v_taxable := v_st - v_disc + v_chg;

  select coalesce(sum(case when a ->> 'mode' = 'percent' then round(v_taxable * (a ->> 'value')::numeric / 100, 2)
                           else round((a ->> 'value')::numeric, 2) end), 0)
    into v_tax
  from jsonb_array_elements(v_adj) a where a ->> 'kind' = 'tax';

  update public.quotations as q set
    total_qty       = v_tq,
    total_weight_kg = v_tw,
    subtotal        = v_st,
    discount_amount = v_disc,
    charges_amount  = v_chg,
    tax_amount      = v_tax,
    grand_total     = v_taxable + v_tax
  where q.id = v_id;

  return jsonb_build_object('id', v_id, 'quote_no', v_quote_no);
end;
$$;

revoke execute on function public.save_quotation(uuid, jsonb, jsonb), public.dashboard_summary() from anon, public;
grant execute on function public.save_quotation(uuid, jsonb, jsonb), public.dashboard_summary() to authenticated;


-- Inventory: remove the created_by / updated_by columns.
-- (Quotations keep created_by: editors may only change their own quotations.)

drop trigger if exists inventory_items_audit on public.inventory_items;

alter table public.inventory_items
  drop column if exists created_by,
  drop column if exists updated_by;

drop trigger if exists inventory_items_touch on public.inventory_items;
create trigger inventory_items_touch
  before update on public.inventory_items
  for each row execute function public.touch_updated_at();


-- Inventory: remove the generated search_text column.
-- The app now searches item_code, description and note directly.

alter table public.inventory_items drop column if exists search_text;


-- Inventory: remove the seq and unit columns.
-- created_at takes over as the order column, so items keep their Excel order.
-- Safe to run more than once, and whether or not 20261020000003/4 have been run.

-- The old audit trigger would undo the created_at change below.
drop trigger if exists inventory_items_audit on public.inventory_items;

-- Rows inserted together share one created_at: spread them 1 microsecond
-- apart in seq order before seq is removed.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'inventory_items' and column_name = 'seq') then
    update public.inventory_items set created_at = created_at + seq * interval '1 microsecond';
  end if;
end $$;

alter table public.inventory_items alter column created_at set default clock_timestamp();

alter table public.inventory_items
  drop column if exists created_by,
  drop column if exists updated_by,
  drop column if exists search_text,
  drop column if exists seq,
  drop column if exists unit;

drop trigger if exists inventory_items_touch on public.inventory_items;
create trigger inventory_items_touch
  before update on public.inventory_items
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- migrations/20261022000001_inventory_loading_actual_weight.sql
-- ---------------------------------------------------------------------
-- Two more columns from the supplier shipment sheet (e.g. "CN3 Anil.xlsx"):
--   LOADING CHARGES  -> loading_charges  (CNY, for the whole row, not per piece)
--   Actual Weight    -> actual_weight    (as written by the supplier, e.g. "5.5-5.6MM";
--                                         tees list run and branch: "5.0-5.2MM / 4.5-5.0MM")
--
-- Run once in Supabase -> SQL Editor. Safe to run again.

alter table public.inventory_items
  add column if not exists loading_charges numeric(14, 2) not null default 0,
  add column if not exists actual_weight text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_items_loading_charges_check') then
    alter table public.inventory_items
      add constraint inventory_items_loading_charges_check check (loading_charges >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventory_items_actual_weight_check') then
    alter table public.inventory_items
      add constraint inventory_items_actual_weight_check check (char_length(actual_weight) <= 100);
  end if;
end
$$;


-- ---------------------------------------------------------------------
-- migrations/20261023000001_quotation_shipment_columns.sql
-- ---------------------------------------------------------------------
-- Quotation lines get the supplier-sheet columns:
--   actual_weight    text           (copied from inventory, e.g. "5.4-5.6MM")
--   loading_charges  numeric        (per line, entered on the quotation)
--   net_amount       generated      = amount + loading_charges  ("Final Total")
-- Lines are priced in RMB (the base currency). The quotation total converts at the end:
--   base_subtotal (RMB) = sum of the lines' final totals
--   subtotal            = base_subtotal x exchange_rate (quotation currency, e.g. INR)
--   then discounts / charges / taxes -> grand_total (quotation currency).
-- Excel-style sheets: quotations.sheet_names (tab names) and quotation_items.sheet (index).
-- Safe to run more than once.

alter table public.quotation_items
  add column if not exists actual_weight text check (char_length(actual_weight) <= 100);
alter table public.quotation_items
  add column if not exists loading_charges numeric(14, 2) not null default 0 check (loading_charges >= 0);
alter table public.quotation_items
  add column if not exists net_amount numeric(18, 2)
    generated always as (round(qty * unit_price, 2) + loading_charges) stored;

alter table public.quotations
  add column if not exists base_subtotal numeric(18, 2) not null default 0;

alter table public.quotation_items
  add column if not exists sheet smallint not null default 0 check (sheet >= 0 and sheet < 20);
alter table public.quotations
  add column if not exists sheet_names jsonb not null default '["Quotation"]'::jsonb;

-- Extra columns typed after Final Total (L, M, ...) and standard columns deleted (hidden) on the sheet.
alter table public.quotations
  add column if not exists extra_columns jsonb not null default '[]'::jsonb
    check (jsonb_typeof(extra_columns) = 'array');
alter table public.quotations
  add column if not exists hidden_columns jsonb not null default '[]'::jsonb
    check (jsonb_typeof(hidden_columns) = 'array');
-- Renamed standard column titles, e.g. {"qty": "PCS"} (missing = the normal title).
alter table public.quotations
  add column if not exists column_titles jsonb not null default '{}'::jsonb
    check (jsonb_typeof(column_titles) = 'object');
alter table public.quotation_items
  add column if not exists extra jsonb not null default '{}'::jsonb
    check (jsonb_typeof(extra) = 'object');

-- Cell formatting from the sheet's Home ribbon (font, colours, alignment, borders, merge), by column id.
alter table public.quotation_items
  add column if not exists fmt jsonb not null default '{}'::jsonb
    check (jsonb_typeof(fmt) = 'object' and length(fmt::text) <= 20000);

create or replace function public.save_quotation(p_id uuid, p_header jsonb, p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id       uuid;
  v_quote_no text;
  v_adj_in   jsonb;
  v_adj      jsonb;
  v_sheets   jsonb;
  v_cols     jsonb;
  v_hidden   jsonb;
  v_titles   jsonb;
  v_st       numeric;
  v_base     numeric;
  v_rate     numeric;
  v_tq       numeric;
  v_tw       numeric;
  v_disc     numeric;
  v_chg      numeric;
  v_taxable  numeric;
  v_tax      numeric;
begin
  if p_header is null or jsonb_typeof(p_header) <> 'object' then
    raise exception 'Invalid quotation header' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Invalid quotation items' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'A quotation can contain at most 500 lines' using errcode = '22023';
  end if;

  -- Validate and normalise the bill lines.
  v_adj_in := coalesce(p_header -> 'adjustments', '[]'::jsonb);
  if jsonb_typeof(v_adj_in) <> 'array' or jsonb_array_length(v_adj_in) > 20 then
    raise exception 'Invalid bill lines' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_adj_in) a
    where case
      when jsonb_typeof(a) <> 'object' then true
      when coalesce(a ->> 'kind', '') not in ('discount', 'charge', 'tax') then true
      when coalesce(a ->> 'mode', '') not in ('percent', 'amount') then true
      when jsonb_typeof(a -> 'value') <> 'number' then true
      when (a ->> 'value')::numeric < 0 or (a ->> 'value')::numeric > 100000000000 then true
      when a ->> 'mode' = 'percent' and (a ->> 'value')::numeric > 100 then true
      when char_length(coalesce(a ->> 'label', '')) > 40 then true
      else false
    end
  ) then
    raise exception 'Invalid bill line' using errcode = '22023';
  end if;

  -- Sheet tabs: 1-20 names of 1-31 characters (Excel's limits).
  v_sheets := coalesce(p_header -> 'sheet_names', '["Quotation"]'::jsonb);
  if jsonb_typeof(v_sheets) <> 'array' or jsonb_array_length(v_sheets) < 1 or jsonb_array_length(v_sheets) > 20
     or exists (select 1 from jsonb_array_elements(v_sheets) n
                where jsonb_typeof(n) <> 'string' or char_length(trim(n #>> '{}')) not between 1 and 31) then
    raise exception 'Invalid sheet names' using errcode = '22023';
  end if;

  -- Extra columns: at most 15, each {key, name}; deleted standard columns: known names only.
  v_cols := coalesce(p_header -> 'extra_columns', '[]'::jsonb);
  if jsonb_typeof(v_cols) <> 'array' or jsonb_array_length(v_cols) > 15
     or exists (select 1 from jsonb_array_elements(v_cols) c
                where jsonb_typeof(c) <> 'object'
                   or coalesce(c ->> 'key', '') !~ '^[A-Za-z0-9]{1,24}$'
                   or char_length(coalesce(c ->> 'name', '')) > 40
                   or (c ? 'after' and coalesce(c ->> 'after', '') not in ('idx', 'description', 'unit_weight_kg', 'actual_weight', 'unit_price', 'qty', 'total_weight', 'amount', 'remarks', 'loading_charges', 'net')))
     or (select count(distinct c ->> 'key') from jsonb_array_elements(v_cols) c) <> jsonb_array_length(v_cols) then
    raise exception 'Invalid extra columns' using errcode = '22023';
  end if;
  -- "after" = the standard column an extra column was inserted after (none = at the end).
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'key', c ->> 'key', 'name', trim(coalesce(c ->> 'name', '')), 'after', c ->> 'after')) order by ord), '[]'::jsonb)
    into v_cols
  from jsonb_array_elements(v_cols) with ordinality as x (c, ord);

  v_hidden := coalesce(p_header -> 'hidden_columns', '[]'::jsonb);
  if jsonb_typeof(v_hidden) <> 'array'
     or exists (select 1 from jsonb_array_elements(v_hidden) h
                where coalesce(h #>> '{}', '') not in ('unit_weight_kg', 'actual_weight', 'unit_price', 'qty',
                                                       'total_weight', 'amount', 'remarks', 'loading_charges')) then
    raise exception 'Invalid hidden columns' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(distinct h), '[]'::jsonb) into v_hidden from jsonb_array_elements(v_hidden) h;

  -- Renamed column titles: known columns only, text of at most 40 characters.
  v_titles := coalesce(p_header -> 'column_titles', '{}'::jsonb);
  if jsonb_typeof(v_titles) <> 'object'
     or exists (select 1 from jsonb_each(v_titles) t
                where t.key not in ('idx', 'description', 'unit_weight_kg', 'actual_weight', 'unit_price', 'qty', 'total_weight', 'amount', 'remarks', 'loading_charges', 'net')
                   or jsonb_typeof(t.value) <> 'string' or char_length(trim(t.value #>> '{}')) > 40) then
    raise exception 'Invalid column titles' using errcode = '22023';
  end if;
  select coalesce(jsonb_object_agg(t.key, trim(t.value #>> '{}')), '{}'::jsonb) into v_titles
  from jsonb_each(v_titles) t where trim(t.value #>> '{}') <> '';

  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', e.a ->> 'kind',
           'label', coalesce(nullif(trim(e.a ->> 'label'), ''),
                             case e.a ->> 'kind' when 'discount' then 'Discount' when 'tax' then 'Tax' else 'Charges' end),
           'mode', e.a ->> 'mode',
           'value', round((e.a ->> 'value')::numeric, 4)
         ) order by e.ord), '[]'::jsonb)
    into v_adj
  from jsonb_array_elements(v_adj_in) with ordinality as e (a, ord);

  if p_id is null then
    insert into public.quotations as q (
      quote_no, prepared_by, status, quote_date, valid_until, reference, customer_name, contact_person,
      customer_email, customer_phone, customer_address, currency, exchange_rate, margin_pct,
      pricing_basis, rate_per_kg, adjustments, sheet_names, extra_columns, hidden_columns, column_titles, notes, terms
    )
    values (
      '',
      (select left(coalesce(nullif(p.full_name, ''), p.email), 160)
         from public.profiles p where p.id = (select auth.uid())),
      coalesce((p_header ->> 'status')::public.quotation_status, 'draft'),
      coalesce((p_header ->> 'quote_date')::date, current_date),
      (p_header ->> 'valid_until')::date,
      nullif(p_header ->> 'reference', ''),
      p_header ->> 'customer_name',
      nullif(p_header ->> 'contact_person', ''),
      nullif(p_header ->> 'customer_email', ''),
      nullif(p_header ->> 'customer_phone', ''),
      nullif(p_header ->> 'customer_address', ''),
      coalesce(p_header ->> 'currency', 'CNY'),
      coalesce((p_header ->> 'exchange_rate')::numeric, 1),
      coalesce((p_header ->> 'margin_pct')::numeric, 0),
      coalesce(p_header ->> 'pricing_basis', 'piece'),
      (p_header ->> 'rate_per_kg')::numeric,
      v_adj,
      v_sheets,
      v_cols,
      v_hidden,
      v_titles,
      nullif(p_header ->> 'notes', ''),
      nullif(p_header ->> 'terms', '')
    )
    returning q.id, q.quote_no into v_id, v_quote_no;
  else
    update public.quotations as q set
      status           = coalesce((p_header ->> 'status')::public.quotation_status, q.status),
      quote_date       = coalesce((p_header ->> 'quote_date')::date, q.quote_date),
      valid_until      = (p_header ->> 'valid_until')::date,
      reference        = nullif(p_header ->> 'reference', ''),
      customer_name    = p_header ->> 'customer_name',
      contact_person   = nullif(p_header ->> 'contact_person', ''),
      customer_email   = nullif(p_header ->> 'customer_email', ''),
      customer_phone   = nullif(p_header ->> 'customer_phone', ''),
      customer_address = nullif(p_header ->> 'customer_address', ''),
      currency         = coalesce(p_header ->> 'currency', q.currency),
      exchange_rate    = coalesce((p_header ->> 'exchange_rate')::numeric, q.exchange_rate),
      margin_pct       = coalesce((p_header ->> 'margin_pct')::numeric, 0),
      pricing_basis    = coalesce(p_header ->> 'pricing_basis', 'piece'),
      rate_per_kg      = (p_header ->> 'rate_per_kg')::numeric,
      adjustments      = v_adj,
      sheet_names      = v_sheets,
      extra_columns    = v_cols,
      hidden_columns   = v_hidden,
      column_titles    = v_titles,
      discount_pct     = 0,
      freight          = 0,
      other_charges    = 0,
      tax_pct          = 0,
      notes            = nullif(p_header ->> 'notes', ''),
      terms            = nullif(p_header ->> 'terms', '')
    where q.id = p_id
    returning q.id, q.quote_no into v_id, v_quote_no;

    if v_id is null then
      raise exception 'Quotation not found or you do not have permission to edit it'
        using errcode = '42501';
    end if;

    delete from public.quotation_items qi where qi.quotation_id = v_id;
  end if;

  insert into public.quotation_items (
    quotation_id, position, inventory_item_id, item_code, description,
    unit, qty, unit_weight_kg, base_price, unit_price, price_overridden, remarks,
    actual_weight, loading_charges, sheet, extra, fmt
  )
  select
    v_id,
    e.ord::integer,
    (select ii.id from public.inventory_items ii
      where ii.id = nullif(e.item ->> 'inventory_item_id', '')::uuid),
    nullif(e.item ->> 'item_code', ''),
    e.item ->> 'description',
    coalesce(nullif(e.item ->> 'unit', ''), 'PCS'),
    coalesce((e.item ->> 'qty')::numeric, 0),
    (e.item ->> 'unit_weight_kg')::numeric,
    (e.item ->> 'base_price')::numeric,
    coalesce((e.item ->> 'unit_price')::numeric, 0),
    coalesce((e.item ->> 'price_overridden')::boolean, false),
    nullif(e.item ->> 'remarks', ''),
    nullif(left(trim(e.item ->> 'actual_weight'), 100), ''),
    greatest(coalesce((e.item ->> 'loading_charges')::numeric, 0), 0),
    least(greatest(coalesce((e.item ->> 'sheet')::integer, 0), 0), jsonb_array_length(v_sheets) - 1),
    -- Only text values (max 300 characters) of columns that exist.
    (select coalesce(jsonb_object_agg(x.key, left(trim(x.value #>> '{}'), 300)), '{}'::jsonb)
       from jsonb_each(case when jsonb_typeof(e.item -> 'extra') = 'object' then e.item -> 'extra' else '{}'::jsonb end) x
      where jsonb_typeof(x.value) = 'string' and trim(x.value #>> '{}') <> ''
        and exists (select 1 from jsonb_array_elements(v_cols) c where c ->> 'key' = x.key)),
    -- Formatting is validated by the app; here only its shape and size are checked.
    case when jsonb_typeof(e.item -> 'fmt') = 'object' and length((e.item -> 'fmt')::text) <= 20000
         then e.item -> 'fmt' else '{}'::jsonb end
  from jsonb_array_elements(p_items) with ordinality as e (item, ord);

  -- Totals: final totals of the lines (RMB) -> x exchange rate -> discounts -> charges
  -- -> taxes (on the taxable amount), all in the quotation currency.
  select coalesce(sum(qi.qty), 0), coalesce(sum(qi.total_weight_kg), 0), coalesce(sum(qi.net_amount), 0)
    into v_tq, v_tw, v_base
  from public.quotation_items qi
  where qi.quotation_id = v_id;

  select case when q.exchange_rate > 0 then q.exchange_rate else 1 end into v_rate
  from public.quotations q where q.id = v_id;
  v_st := round(v_base * v_rate, 2);

  select coalesce(sum(case when a ->> 'mode' = 'percent' then round(v_st * (a ->> 'value')::numeric / 100, 2)
                           else round((a ->> 'value')::numeric, 2) end), 0)
    into v_disc
  from jsonb_array_elements(v_adj) a where a ->> 'kind' = 'discount';

  select coalesce(sum(case when a ->> 'mode' = 'percent' then round(v_st * (a ->> 'value')::numeric / 100, 2)
                           else round((a ->> 'value')::numeric, 2) end), 0)
    into v_chg
  from jsonb_array_elements(v_adj) a where a ->> 'kind' = 'charge';

  v_taxable := v_st - v_disc + v_chg;

  select coalesce(sum(case when a ->> 'mode' = 'percent' then round(v_taxable * (a ->> 'value')::numeric / 100, 2)
                           else round((a ->> 'value')::numeric, 2) end), 0)
    into v_tax
  from jsonb_array_elements(v_adj) a where a ->> 'kind' = 'tax';

  update public.quotations as q set
    total_qty       = v_tq,
    total_weight_kg = v_tw,
    base_subtotal   = v_base,
    subtotal        = v_st,
    discount_amount = v_disc,
    charges_amount  = v_chg,
    tax_amount      = v_tax,
    grand_total     = v_taxable + v_tax
  where q.id = v_id;

  return jsonb_build_object('id', v_id, 'quote_no', v_quote_no);
end;
$$;

-- Inventory imported from "LOADING PLAN FOR MOTI 2026-10-14.xlsx" (sheet "Sheet1").
-- Generated by scripts/generate-seed.ts. Optional: run once to pre-load the inventory.
-- (You can also import the same Excel file from the Inventory page.)
insert into public.inventory_items (item_code, description, weight_kg, unit_price, stock_qty, note, created_at)
values
  ('V1', '21X2MM', 0.037, 0.5, 2000, '65MM', now() + interval '0 microseconds'),
  ('W6', '27X2MM', 0.054, 0.58, 1000, '65MM', now() + interval '1 microseconds'),
  (null, '33X2MM', null, 0.61, 5000, '80MM', now() + interval '2 microseconds'),
  ('A1', '33X2.5MM', 0.1, 0.65, 5000, '80MM', now() + interval '3 microseconds'),
  ('B1', '42X2.5MM', 0.14, 0.82, 50000, '95MM', now() + interval '4 microseconds'),
  ('C1', '48X2.5MM', 0.2, 1, 2000, '115MM', now() + interval '5 microseconds'),
  ('D2', '60X2.5MM', 0.3, 1.53, 2000, '145MM', now() + interval '6 microseconds'),
  ('U1', '76X3MM', 0.6, 2.8, 2000, '190MM', now() + interval '7 microseconds'),
  ('E1', '89X3MM', 0.9, 3.75, 1000, '225MM', now() + interval '8 microseconds'),
  ('F1', '114X3.5MM', 1.6, 6.7, 1000, '300MM', now() + interval '9 microseconds'),
  ('G1', '140X3.5MM', 2.6, 10.2, 1000, '370MM', now() + interval '10 microseconds'),
  ('H1', '165X3.75MM', 4, 14.3, 2000, '440MM', now() + interval '11 microseconds'),
  ('J1', '219X3.5MM', 6.8, 28.6, 300, '560MM', now() + interval '12 microseconds'),
  ('K1', '273X4MM', 11, 47.5, 200, '700MM', now() + interval '13 microseconds'),
  ('L1', '325X4MM', 16, 69, 100, '840MM', now() + interval '14 microseconds'),
  ('W1', '27X2.5MM', 0.08, 0.6, 1000, '65MM', now() + interval '15 microseconds'),
  ('A2', '33X3MM', 0.14, 0.85, 2000, 'S', now() + interval '16 microseconds'),
  ('B3', '42X4MM', 0.21, 1.03, 600, '95MM', now() + interval '17 microseconds'),
  ('C3', '48X4MM', 0.28, 1.13, 10000, '115MM', now() + interval '18 microseconds'),
  ('D3', '60X4MM', 0.45, 1.8, 10000, '145MM', now() + interval '19 microseconds'),
  ('U2', '76X4MM', 0.78, 3.5, 2000, '190MM', now() + interval '20 microseconds'),
  ('E3', '89X4.25MM', 1.15, 4.55, 2000, '225MM', now() + interval '21 microseconds'),
  ('F3', '114X4.75MM', 2.25, 8.7, 1000, '300MM', now() + interval '22 microseconds'),
  ('G2', '140X5MM', 3.4, 13, 600, '370MM', now() + interval '23 microseconds'),
  ('H2', '165X4.75MM', 5, 18.9, 3000, '440MM', now() + interval '24 microseconds'),
  ('J2', '219X5MM (The actual thickness is 4.5MM)', 8.8, 36, 100, '560MM', now() + interval '25 microseconds'),
  ('J3', '219X5.75MM', 10.1, 39.5, 50, '560MM', now() + interval '26 microseconds'),
  ('K25', '273X5MM (The actual thickness is 4.5MM)', 16.5, 56, 100, '700MM', now() + interval '27 microseconds'),
  ('K2', '273X5.75MM', 16.5, 62, 100, '700MM', now() + interval '28 microseconds'),
  ('L32', '325X5MM (The actual thickness is 4.5MM)', 20.2, 81, 60, '840MM', now() + interval '29 microseconds'),
  ('L2', '325X5.75MM', 24, 87, 60, '840MM', now() + interval '30 microseconds'),
  ('P1', '457X5.8MM', 56, 242, 36, '1280MM', now() + interval '31 microseconds'),
  ('A4', '1"XSCH40', 0.18, 0.95, 5000, 'Standard', now() + interval '32 microseconds'),
  ('C4', '11/2"XSCH40', 0.3, 1.58, 10000, 'Standard', now() + interval '33 microseconds'),
  ('D4', '2"XSCH40', 0.6, 2.85, 12000, 'Standard', now() + interval '34 microseconds'),
  ('U3', '21/2"XSCH40', 1.15, 5, 600, 'Standard', now() + interval '35 microseconds'),
  ('F5', '114XSCH40(OIL PIPE)', 3.2, 11.3, 600, 'Standard', now() + interval '36 microseconds'),
  ('H4', '6"XSCH40', 8.8, 35, 1000, 'Standard', now() + interval '37 microseconds'),
  ('J7', '219XSCH40', 18, 64, 36, 'Standard', now() + interval '38 microseconds'),
  ('K7', '273XSCH40', 32, 122, 50, 'Standard', now() + interval '39 microseconds'),
  ('Q5', '20"XSTD', 130, 485, 6, 'Standard', now() + interval '40 microseconds'),
  ('S2', '22"XSTD', 165, 630, 6, 'Standard', now() + interval '41 microseconds'),
  ('H3', '165X5MM', 6.5, 26, 400, 'Standard', now() + interval '42 microseconds'),
  ('J6', '219X6.5MM', 15, 59.5, 300, 'Standard', now() + interval '43 microseconds'),
  ('K5', '273X6.5MM', 25, 93, 200, 'Standard', now() + interval '44 microseconds'),
  ('L5', '325X6.5MM', 37, 130, 50, 'Standard', now() + interval '45 microseconds'),
  ('K6', '273X8MM', 31.6, 105, 50, 'Standard', now() + interval '46 microseconds'),
  ('L6', '325X8MM', 40, 150, 50, 'Standard', now() + interval '47 microseconds'),
  ('M5', '355X8MM', 50, 198, 24, 'Standard', now() + interval '48 microseconds'),
  ('P3', '457X8MM', 89, 350, 6, 'Standard', now() + interval '49 microseconds'),
  (null, '22"X8MM(8.5MM)', null, 610, 12, 'Standard', now() + interval '50 microseconds'),
  (null, '24"X8MM(8.38MM)', null, 645, 6, 'Standard', now() + interval '51 microseconds'),
  ('V8', '1/2"XSCH80', 0.1, 1.1, 200, 'Standard', now() + interval '52 microseconds'),
  ('W8', '3/4"XSCH80', 0.15, 1.2, 500, 'Standard', now() + interval '53 microseconds'),
  ('A5', '1"XSCH80', 0.18, 1.5, 1000, 'Standard', now() + interval '54 microseconds'),
  ('C5', '11/2"XSCH80', 0.45, 2.4, 2000, 'Standard', now() + interval '55 microseconds'),
  ('D5', '2"XSCH80(4.5-5.2MM)', 0.8, 4, 2000, 'Standard', now() + interval '56 microseconds'),
  ('D5', '2"XSCH80(4.8-5.2MM)', 0.8, 4.2, 2000, 'Standard', now() + interval '57 microseconds'),
  ('U4', '21/2"XSCH80', 1.55, 8.1, 200, 'Standard', now() + interval '58 microseconds'),
  ('E5', '3"XSCH80', 2.65, 12.5, 600, 'Standard', now() + interval '59 microseconds'),
  ('F6', '4"XSCH80(CTW NOT SEAMLESS )', 5, 22, 200, 'Standard', now() + interval '60 microseconds'),
  ('H5', '6"XSCH80', 14.7, 61, 100, 'Standard', now() + interval '61 microseconds'),
  ('J8', '8"XSCH80', 28.5, 121, 50, 'Standard', now() + interval '62 microseconds'),
  ('K8', '10"XSCH80', 53, 230, 12, 'Standard', now() + interval '63 microseconds'),
  ('L12', '12"XSCH80', 88, 380, 6, 'Standard', now() + interval '64 microseconds'),
  ('A9', '1"XSCH 160', 0.3, 6.5, 100, 'Standard', now() + interval '65 microseconds'),
  ('C11', '11/2"XSCH 160', 0.8, 6.2, 200, 'Standard', now() + interval '66 microseconds'),
  ('D16', '2"XSCH 160', 1.35, 9, 300, 'Standard', now() + interval '67 microseconds'),
  ('U14', '21/2"XSCH 160', 2.4, 13.5, 24, 'Standard', now() + interval '68 microseconds'),
  ('E13', '3"XSCH 160', 4.1, 22.5, 100, 'Standard', now() + interval '69 microseconds'),
  ('F14', '4"XSCH 160', 8.15, 43, 36, 'Standard', now() + interval '70 microseconds'),
  ('G10', '5"XSCH40 1D', 3.8, 20, 24, 'Standard', now() + interval '71 microseconds'),
  (null, '1/2"XSCH80 1D', null, 1.7, 100, 'Standard', now() + interval '72 microseconds'),
  (null, '3/4"XSCH80 1D', null, 1.9, 100, 'Standard', now() + interval '73 microseconds'),
  (null, '1"XSCH80 1D', null, 2.3, 100, 'Standard', now() + interval '74 microseconds'),
  (null, '11/4"XSCH80 1D', null, 2.3, 50, 'Standard', now() + interval '75 microseconds'),
  ('C12', '11/2"XSCH80 1D', null, 3.3, 100, 'Standard', now() + interval '76 microseconds'),
  ('D18', '2"XSCH80 1D', 0.6, 5, 100, 'Standard', now() + interval '77 microseconds'),
  ('U16', '21/2"XSCH80 1D', 1.05, 7.2, 24, 'Standard', now() + interval '78 microseconds'),
  ('E15', '3"XSCH80 1D', 1.75, 11, 50, 'Standard', now() + interval '79 microseconds'),
  ('F18', '4"XSCH80 1D', 3.5, 19.5, 36, 'Standard', now() + interval '80 microseconds'),
  ('G14', '5"XSCH80 1D', null, 33, 12, 'Standard', now() + interval '81 microseconds'),
  ('H20', '6"XSCH80 1D', 10.3, 48, 12, 'Standard', now() + interval '82 microseconds'),
  ('J26', '8"XSCH80 1D', 18.7, 90, 6, 'Standard', now() + interval '83 microseconds'),
  (null, '89X4.5MM 45°', null, 4.3, 200, 'Standard', now() + interval '84 microseconds'),
  (null, '114X4.5MM 45°', null, 7.1, 200, 'Standard', now() + interval '85 microseconds'),
  (null, '140X4.5MM 45°', null, 11, 60, 'Standard', now() + interval '86 microseconds'),
  (null, '165X4.5MM 45°', null, 15.3, 200, 'Standard', now() + interval '87 microseconds'),
  (null, '219X5.5MM 45°', null, 28, 60, 'Standard', now() + interval '88 microseconds'),
  (null, '273X5.5MM 45°', null, 45, 36, 'Standard', now() + interval '89 microseconds'),
  (null, '325X5.5MM 45°', null, 64, 36, 'Standard', now() + interval '90 microseconds'),
  ('D12', '2"XSCH40 45°', 0.33, 1.9, 200, 'Standard', now() + interval '91 microseconds'),
  ('U13', '21/2"XSCH40 45°', 0.6, 3.3, 200, 'Standard', now() + interval '92 microseconds'),
  ('E12', '3"XSCH40 45°', 1, 4.9, 200, 'Standard', now() + interval '93 microseconds'),
  ('F13', '4"XSCH40 45°', 1.77, 8.2, 100, 'Standard', now() + interval '94 microseconds'),
  ('H15', '6"XSCH40 45°', 4.3, 20.2, 100, 'Standard', now() + interval '95 microseconds'),
  ('J23', '8"XSCH40 45°', 9, 36, 50, 'Standard', now() + interval '96 microseconds'),
  ('L37', '12"XSTD 45°', 25, 98, 24, 'Standard', now() + interval '97 microseconds'),
  ('V7', '1/2"XSCH40 180°', 0.14, 2, 1000, 'Standard', now() + interval '98 microseconds'),
  ('W7', '3/4"XSCH40 180°', 0.16, 2.2, 1000, 'Standard', now() + interval '99 microseconds'),
  ('A10', '1"XSCH40 180°', 0.23, 2.8, 600, 'Standard', now() + interval '100 microseconds'),
  ('C9', '11/2"XSCH40 180°', 0.7, 5, 600, 'Standard', now() + interval '101 microseconds'),
  ('D9', '2"XSCH40 180°(C-C 152.4MM)', 1.2, 7, 600, 'Standard', now() + interval '102 microseconds'),
  ('E9', '3"XSCH40 180°', 3.6, 17.5, 50, 'Standard', now() + interval '103 microseconds'),
  ('F10', '4"XSCH40 180°', 7.5, 32, 24, 'Standard', now() + interval '104 microseconds'),
  ('AB1', '6"XSCH40 3D BEND', 20, 99, 200, 'Standard', now() + interval '105 microseconds'),
  ('V4', '1/2"XSCH40 TEE', 0.1, 1.6, 400, null, now() + interval '106 microseconds'),
  ('W4', '3/4"XSCH40 TEE', 0.15, 1.75, 400, null, now() + interval '107 microseconds'),
  ('A6', '1"XSCH40 TEE', 0.25, 2.3, 600, null, now() + interval '108 microseconds'),
  ('B6', '11/4"XSCH40 TEE', 0.4, 3.3, 300, null, now() + interval '109 microseconds'),
  ('C6', '11/2"XSCH40 TEE', 0.63, 4.2, 300, null, now() + interval '110 microseconds'),
  ('D6', '2"XSCH40 TEE', 0.8, 5.2, 400, null, now() + interval '111 microseconds'),
  ('U7', '21/2"XSCH40 TEE', 1.65, 9.35, 100, null, now() + interval '112 microseconds'),
  ('E6', '3"XSCH40 TEE', 2.2, 12.5, 200, null, now() + interval '113 microseconds'),
  ('F7', '4"XSCH40 TEE', 4.15, 19.5, 200, null, now() + interval '114 microseconds'),
  ('G6', '5"XSCH40 TEE', 6.8, 32, 36, null, now() + interval '115 microseconds'),
  ('H9', '6"XSCH40 TEE', 8.9, 42, 50, null, now() + interval '116 microseconds'),
  ('J12', '8"XSCH40 TEE', 14.6, 81, 24, null, now() + interval '117 microseconds'),
  ('K13', '10"XSCH40 TEE', 24, 135, 12, null, now() + interval '118 microseconds'),
  ('Q12', '20"XSTD TEE', 85, 480, 4, null, now() + interval '119 microseconds'),
  ('H8', '6"XSCH20 TEE', 6.3, 34, 100, null, now() + interval '120 microseconds'),
  ('J11', '8"XSCH20 TEE', 13, 68, 12, null, now() + interval '121 microseconds'),
  ('K12', '10"XSCH20 TEE', 18, 110, 12, null, now() + interval '122 microseconds'),
  ('L13', '12"XSCH20 TEE', 26.8, 150, 6, null, now() + interval '123 microseconds'),
  ('AZ10', '3/4"X1/2"XSCH40 TEE', null, 1.75, 100, null, now() + interval '124 microseconds'),
  ('Z1', '1"X1/2"XSCH40 TEE', 0.25, 2.2, 300, null, now() + interval '125 microseconds'),
  ('AZ9', '11/4"X1"XSCH40 TEE', 0.62, 3, 100, null, now() + interval '126 microseconds'),
  ('Z8', '11/4"X3/4"XSCH40 TEE', 0.4, 3, 50, null, now() + interval '127 microseconds'),
  ('Z7', '11/4"X1/2"XSCH40 TEE', 0.4, 3, 50, null, now() + interval '128 microseconds'),
  ('Z6', '11/2"X1"XSCH40 TEE', 0.62, 4, 300, null, now() + interval '129 microseconds'),
  ('Z3', '11/2"X1/2"XSCH40 TEE', 0.5, 3.9, 100, null, now() + interval '130 microseconds'),
  ('Z11', '2"X11/2"XSCH40 TEE', 0.75, 5, 100, null, now() + interval '131 microseconds'),
  ('Z13', '2"X1"XSCH40 TEE', 0.7, 4.6, 200, null, now() + interval '132 microseconds'),
  ('Z9', '2"X1/2"XSCH40 TEE', 0.7, 4.6, 100, null, now() + interval '133 microseconds'),
  ('Z19', '21/2"X2"XSCH40 TEE', 1.45, 7.9, 50, null, now() + interval '134 microseconds'),
  ('Z18', '21/2"X11/2"XSCH40 TEE', 1.35, 7.9, 50, null, now() + interval '135 microseconds'),
  ('Z17', '21/2"X11/4"XSCH40 TEE', 1.3, 7.9, 24, null, now() + interval '136 microseconds'),
  (null, '3"X4MM TEE', 1.8, 10.5, 200, null, now() + interval '137 microseconds'),
  ('Z25', '3"X2"XSCH40 TEE', 2.05, 10.5, 200, null, now() + interval '138 microseconds'),
  ('Z24', '3"X11/2"XSCH40 TEE', 1.95, 10, 200, null, now() + interval '139 microseconds'),
  ('Z23', '3"X11/4"XSCH40 TEE', 2, 10, 24, null, now() + interval '140 microseconds'),
  ('Z22', '3"X1"XSCH40 TEE', 1.9, 10, 50, null, now() + interval '141 microseconds'),
  ('Z21', '3"X3/4"XSCH40 TEE', 1.9, 10.5, 6, null, now() + interval '142 microseconds'),
  ('Z20', '3"X1/2"XSCH40 TEE', 1.75, 10.5, 12, null, now() + interval '143 microseconds'),
  ('Z114', '4"X4.5MM TEE', 3.3, 17, 100, null, now() + interval '144 microseconds'),
  ('Z34', '4"X3"XSCH40 TEE', 3.85, 18, 36, null, now() + interval '145 microseconds'),
  ('Z32', '4"X2"XSCH40 TEE', 3.3, 16, 24, null, now() + interval '146 microseconds'),
  ('Z39', '5"X21/2"XSCH40 TEE', 5.52, 27, 12, null, now() + interval '147 microseconds'),
  ('Z38', '5"X2"XSCH40 TEE', 5.65, 27, 12, null, now() + interval '148 microseconds'),
  ('Z45', '6"X4"XSCH40 TEE', 8, 37, 12, null, now() + interval '149 microseconds'),
  ('Z106', '6"X4"XSCH20 TEE', 6.1, 31, 12, null, now() + interval '150 microseconds'),
  ('Z49', '8"X3"XSCH40 TEE', 13.4, 67, 12, null, now() + interval '151 microseconds'),
  ('Z53', '10"X3"XSCH40 TEE', 23, 115, 6, null, now() + interval '152 microseconds'),
  ('Z61', '12"X8"XSTD TEE', 34.5, 170, 6, null, now() + interval '153 microseconds'),
  ('A8', '1"XSCH40 CAP', 0.08, 0.9, 1000, null, now() + interval '154 microseconds'),
  ('C8', '11/2"XSCH40 CAP', 0.15, 1.1, 1000, null, now() + interval '155 microseconds'),
  ('D8', '2"XSCH40 CAP', 0.17, 1.2, 1000, null, now() + interval '156 microseconds'),
  ('U9', '21/2"XSCH40 CAP', 0.35, 1.7, 300, null, now() + interval '157 microseconds'),
  ('E8', '3"XSCH40 CAP', 0.5, 2.8, 600, null, now() + interval '158 microseconds'),
  ('F9', '4"XSCH40 CAP', 0.9, 4.6, 600, null, now() + interval '159 microseconds'),
  ('G8', '5"XSCH40 CAP', 1.55, 8.3, 100, null, now() + interval '160 microseconds'),
  ('H11', '6"XSCH40 CAP', 2.15, 9.5, 300, null, now() + interval '161 microseconds'),
  ('J14', '8"XSCH40 CAP', 4.05, 18.5, 60, null, now() + interval '162 microseconds'),
  ('K23', '10"X7MM CAP', 7.3, 32, 36, null, now() + interval '163 microseconds'),
  ('L18', '12"XSTD CAP', 10.15, 46, 36, null, now() + interval '164 microseconds'),
  (null, '14"X8MM CAP', 12, 57, 24, null, now() + interval '165 microseconds'),
  ('T13', '24"XSTD CAP', 36.05, 175, 6, null, now() + interval '166 microseconds'),
  ('X94', '20"X16"XSTD REDUCER', 53, 255, 6, null, now() + interval '167 microseconds'),
  ('X86', '18"X16"XSTD REDUCER', 34, 165, 4, null, now() + interval '168 microseconds'),
  ('X87', '18"X14"XSTD REDUCER', 36.6, 180, 12, null, now() + interval '169 microseconds'),
  ('X88', '18"X12"XSTD REDUCER', 41.4, 205, 4, null, now() + interval '170 microseconds'),
  ('X89', '18"X10"XSTD REDUCER', 33.9, 238, 6, null, now() + interval '171 microseconds'),
  ('X80', '16"X14"XSTD REDUCER', 23.5, 130, 6, null, now() + interval '172 microseconds'),
  ('X81', '16"X12"XSTD REDUCER', 29.5, 145, 6, null, now() + interval '173 microseconds'),
  ('X82', '16"X10"XSTD REDUCER', 30.1, 163, 24, null, now() + interval '174 microseconds'),
  ('X83', '16"X8"XSTD REDUCER', 28.25, 188, 6, null, now() + interval '175 microseconds'),
  ('X75', '14"X12"XSTD REDUCER', 24.8, 108, 6, null, now() + interval '176 microseconds'),
  ('X76', '14"X10"XSTD REDUCER', 23.5, 116, 6, null, now() + interval '177 microseconds'),
  ('X72', '12"X10"XSTD REDUCER', 12.6, 55, 60, null, now() + interval '178 microseconds'),
  ('X721', '12"X8"XSTD REDUCER', 13.1, 59, 60, null, now() + interval '179 microseconds'),
  ('X105', '12"X4"XSTD REDUCER', 14.5, 83, 24, null, now() + interval '180 microseconds'),
  ('X106', '12"X3"XSTD REDUCER', 12.65, 95, 6, null, now() + interval '181 microseconds'),
  ('X70', '10"X8"XSCH40 REDUCER', 9.1, 39, 50, null, now() + interval '182 microseconds'),
  ('X69', '10"X6"XSCH40 REDUCER', 9.35, 44, 100, null, now() + interval '183 microseconds'),
  ('X67', '10"X4"XSCH40 REDUCER', 10.65, 56, 36, null, now() + interval '184 microseconds'),
  ('X61', '8"X6"XSCH40 REDUCER', 5.3, 22.8, 100, null, now() + interval '185 microseconds'),
  ('X60', '8"X5"XSCH40 REDUCER', 5.25, 24.3, 60, null, now() + interval '186 microseconds'),
  ('X59', '8"X4"XSCH40 REDUCER', 5.35, 28, 100, null, now() + interval '187 microseconds'),
  ('X58', '8"X3"XSCH40 REDUCER', 6, 32, 50, null, now() + interval '188 microseconds'),
  ('X57', '8"X21/2"XSCH40 REDUCER', 6.45, 36, 36, null, now() + interval '189 microseconds'),
  ('X53', '6"X5"XSCH40 REDUCER', 3.45, 14, 300, null, now() + interval '190 microseconds'),
  ('X52', '6"X4"XSCH40 REDUCER', 3.45, 14.7, 300, null, now() + interval '191 microseconds'),
  ('X51', '6"X3"XSCH40 REDUCER', 3.4, 16.4, 200, null, now() + interval '192 microseconds'),
  ('X50', '6"X21/2"XSCH40 REDUCER', 3.8, 18.2, 100, null, now() + interval '193 microseconds'),
  ('X49', '6"X2"XSCH40 REDUCER', 3.22, 20, 60, null, now() + interval '194 microseconds'),
  ('Y83', '14"X10"XSTD REDUCER', 26.35, 145, 6, null, now() + interval '195 microseconds'),
  ('Y87', '12"X10"XSTD REDUCER', 13.2, 65, 12, null, now() + interval '196 microseconds'),
  ('Y88', '12"X8"XSTD REDUCER', 13.85, 83, 24, null, now() + interval '197 microseconds'),
  ('Y70', '10"X8"XSCH40 REDUCER', 9.5, 47, 36, null, now() + interval '198 microseconds'),
  ('Y69', '10"X6"XSCH40 REDUCER', 9.9, 55, 36, null, now() + interval '199 microseconds'),
  ('Y68', '10"X5"XSCH40 REDUCER', 9.8, 71, 24, null, now() + interval '200 microseconds'),
  ('Y67', '10"X4"XSCH40 REDUCER', 10, 89, 12, null, now() + interval '201 microseconds');


commit;
