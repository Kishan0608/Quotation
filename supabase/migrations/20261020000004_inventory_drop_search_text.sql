-- Inventory: remove the generated search_text column.
-- The app now searches item_code, description and note directly.

alter table public.inventory_items drop column if exists search_text;
