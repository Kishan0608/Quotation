-- Inventory keeps only the supplier sheet's own columns: Items, WT, RMB/PCS, QTY, actual weight
-- and Note / Length. The item number, loading charges and the stored totals are gone (the
-- totals are worked out from weight / price x quantity wherever they are shown).
--
-- On the live database these columns were already dropped by hand; this file records it and
-- fixes the dashboard summary, which still added up the dropped total columns.

alter table public.inventory_items drop column if exists item_code;
alter table public.inventory_items drop column if exists loading_charges;
alter table public.inventory_items drop column if exists total_weight_kg;
alter table public.inventory_items drop column if exists total_amount;

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
        'total_weight_kg', coalesce(sum(coalesce(i.weight_kg, 0) * i.stock_qty), 0),
        'total_value', coalesce(sum(coalesce(i.unit_price, 0) * i.stock_qty), 0),
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
