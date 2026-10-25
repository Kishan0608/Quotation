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
