-- Undo of the 2026-10-28 inventory merge: puts back the 11 rows that were removed when
-- same-name + same-length items were merged into one entry. Safe to run more than once.
-- (total_weight_kg and total_amount are calculated by the database.)
insert into public.inventory_items (id, item_code, description, note, weight_kg, unit_price, stock_qty, loading_charges, actual_weight, created_at, updated_at)
values
  ('17e4d4e2-8dbb-44e7-b5a8-8f93d4a4fbc3', 'A10', '1"XSCH80', 'Standard', 0.19, 1.35, 70, 0.5, '4.0-4.5MM', '2026-10-22T13:04:47.639495+00:00', '2026-10-22T13:04:47.525495+00:00'),
  ('6c604845-6acd-4e8f-a4b7-263fa88bd0cb', null, '11/2"XSCH160', 'Standard', 0.65, 6.2, 500, 8, '6.5-7.5MM', '2026-10-22T13:04:47.584495+00:00', '2026-10-22T13:04:47.525495+00:00'),
  ('47ac14d2-22ac-4a17-a701-55cff7d37efe', null, '11/4"XSCH160', 'Standard', 0.45, 4.5, 48, 0, '5.7-6.2MM', '2026-10-22T12:09:40.69761+00:00', '2026-10-22T12:09:40.66061+00:00'),
  ('9084873b-8928-4a14-8695-5368a81d2a17', null, '14"XSTD', 'Standard', 64, 217, 3, 0, '8.3-9.0MM', '2026-10-22T13:30:11.442199+00:00', '2026-10-22T13:30:11.411199+00:00'),
  ('c1096203-d161-4238-83d8-112be6873640', null, '16"X12"XSTD REDUCER', 'CONCENTRIC', 29.5, 125, 10, 0, '8.9-9.0MM / 9.0-10.0MM', '2026-10-22T13:04:47.611495+00:00', '2026-10-22T13:04:47.525495+00:00'),
  ('30a41fc0-ef87-4bc3-baf3-3c77ada270b4', null, '2"XSCH160', 'Standard', 1.43, 9.8, 300, 11, '9.5-12.5MM', '2026-10-22T13:04:47.580495+00:00', '2026-10-22T13:04:47.525495+00:00'),
  ('801b6be0-1f76-494b-bbed-8cd8ca347cea', null, '219XSCH40', 'Standard', 18, 63, 103, 0, '7.2-7.8MM', '2026-10-22T13:30:11.420199+00:00', '2026-10-22T13:30:11.411199+00:00'),
  ('b5f99136-322a-43c2-8532-576a61383080', 'K25', '273X5.75MM', '700MM', 16.5, 61, 95, 39, '5.2-5.5MM', '2026-10-22T13:30:11.430199+00:00', '2026-10-22T13:30:11.411199+00:00'),
  ('0c435d29-758b-4d6f-b84a-48b5079df35f', 'L2', '325X5MM', '840MM', 20.2, 82, 14, 7, null, '2026-10-22T13:30:11.414199+00:00', '2026-10-22T13:30:11.411199+00:00'),
  ('198c6c1e-8f07-449f-b470-1b1178bbc819', null, '355X5.75MM', 'Standard', 41, 173, 7, 8, '6.0-6.5MM', '2026-10-22T13:30:11.432199+00:00', '2026-10-22T13:30:11.411199+00:00'),
  ('ebf638bf-7769-45d1-87b6-8764d3b080f9', 'B2', '42X4MM', '95MM', 0.18, 1.02, 2000, 9, '3.2-3.5MM', '2026-10-22T12:26:19.739671+00:00', '2026-10-22T12:26:19.719671+00:00'),
  ('5d09fe0e-5e42-40b2-8190-93649fb58343', null, '4"XSTD 45°', 'Standard', 1.77, 3.6, 5, 0, '5.2-5.5MM', '2026-10-22T13:04:47.645495+00:00', '2026-10-22T13:04:47.525495+00:00')
on conflict (id) do nothing;
-- P1 457X5.8MM 1280MM quantity before it was set back to the MOTI plan's 36 on 2026-10-29.
update public.inventory_items set stock_qty = 1000 where id = '1bac9e6b-5757-4c26-adc0-a2c1ceb04eb0';
