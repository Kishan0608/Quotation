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
