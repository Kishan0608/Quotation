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
