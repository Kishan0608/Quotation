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
