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
