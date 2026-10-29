-- Undo of the 2026-10-29 NAVEEN + DEEPAK import: old prices back, the 8 added items removed.
-- Run in the Supabase SQL Editor. (Prices are put back only where they are still the imported price.)
with p(id, old_price, new_price) as (values
  ('35ba3003-d3aa-4e4e-8798-a9ae3d858678'::uuid, 0.82, 0.8),
  ('422cfe41-f27b-4d79-85f9-c991752b53b9'::uuid, 3.75, 3.7),
  ('32422e73-c901-410c-b65f-dfc801c6fe9c'::uuid, 28.6, 28.5),
  ('1d250d0c-e2e9-4598-b92c-a07751a0c0fe'::uuid, 39.5, 39),
  ('c4571006-4b35-4439-9e4e-41d2d3f57544'::uuid, 47.5, 47),
  ('659810ea-4a33-4698-add3-a6528b63880b'::uuid, 61.5, 61),
  ('60069bb0-c8d7-4658-bd9a-74250599be8c'::uuid, 69, 68),
  ('b23f7e5a-dad4-4a4e-94f1-93f654048b18'::uuid, 87, 86),
  ('6d63b5a8-1b97-476c-a543-ca5df7c0b603'::uuid, 108, 107),
  ('43999b9e-d496-4f8e-adc1-240d62047075'::uuid, 1.5, 1.35),
  ('96ff8a31-79bc-4cac-b422-77836ef19c20'::uuid, 39, 39.5),
  ('b329d554-ac72-4a58-a748-bac31044e376'::uuid, 173, 172),
  ('26586235-bb16-47fd-9e57-8b4b063f0b14'::uuid, 227, 225),
  ('0c62c7a6-8e41-4bbb-9064-ce6585139c3c'::uuid, 83, 80),
  ('9c3601ef-e8b9-4ffd-bead-a5e660524a78'::uuid, 81, 80),
  ('f44d3448-2ef4-4a8f-a4ea-842d25c7015b'::uuid, 5.2, 5),
  ('2ee197c1-9eed-459e-a915-8b95230898f8'::uuid, 32, 31),
  ('7d8fa77c-55e8-4fec-b089-362f716127ee'::uuid, 1.1, 1),
  ('ebb0d657-1d90-4110-a288-e65badb0212b'::uuid, 67, 68),
  ('794e540e-adaf-4dfe-bde6-38993e3f6e76'::uuid, 1.13, 1.12),
  ('0cabdf0b-f680-4af0-b5ee-a58f1347bdb7'::uuid, 13, 12.8),
  ('e5a317df-0193-4fbe-9a8c-4fc594749568'::uuid, 18.9, 18.7),
  ('82247c4b-b859-4883-85c4-9206f43c0696'::uuid, 302, 300),
  ('09954d74-8a9a-488a-ac79-56e78610a89b'::uuid, 2.85, 2.8),
  ('24db14b3-c8a7-4bbb-9fd2-0835caf6d3a4'::uuid, 5, 4.95),
  ('ad1193a8-4312-4042-9d95-66673bf31ba1'::uuid, 35, 34.5),
  ('27250054-97d1-41db-b295-9d7b5edb85c9'::uuid, 122, 120),
  ('6ee65d62-3a28-429a-9e6d-2d35cea31c5f'::uuid, 3.95, 4),
  ('1da288f5-9377-40e0-b67f-dc46a393333f'::uuid, 99, 95),
  ('6c0ecae1-905a-4b3b-be5f-3a77f1869212'::uuid, 4.2, 4.15),
  ('79d80dcd-9f5d-4c35-8c8c-2f3f73ebb18d'::uuid, 12.5, 12.3),
  ('ab0a65a5-db82-4ef2-b3cf-a3978b04d303'::uuid, 37, 36.5),
  ('4ea26b0e-8911-42b9-834e-aa27ae55927a'::uuid, 36.5, 36),
  ('c0ed8223-0d66-4ee1-bd12-e0a18993e3bf'::uuid, 4.6, 4.5),
  ('e013a6ab-2001-4b92-b60e-4901cfac6f8c'::uuid, 108, 100),
  ('4f2acf03-2e7a-4504-945d-96c44b67c947'::uuid, 56, 55),
  ('55bffa8e-9f5b-442a-86a2-72ccd3677e90'::uuid, 56, 58)
)
update public.inventory_items i set unit_price = p.old_price
from p where i.id = p.id and i.unit_price = p.new_price;

delete from public.inventory_items where id in ('fda28339-4276-4819-8dbe-71fc7092a23f', 'b3e7cf0e-346e-4423-aa75-bb9101cecfa1', 'c7db8718-dcaa-4b01-b5a9-d1d9c6c25dbc', '2b27ea48-4eca-4afb-a0de-1ca9051b1902', '73f173b4-22bb-47f7-9e2b-e2d57d4ca05e', '434fdbbe-bc90-4100-b946-e2f903449b35', 'aa2f606c-4a79-4bcb-9eaa-06c0d3e59a87', '97c57d5d-5d6b-4ffc-83c7-86e245e181da');
