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
