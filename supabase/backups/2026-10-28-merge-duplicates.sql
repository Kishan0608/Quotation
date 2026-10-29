-- Makes the inventory unique by item name + length (the user's choice, 2026-10-28): removes the
-- 12 extra rows of items that the supplier sheets listed with a blank or different Item No.
-- Each row is removed only while the entry that is kept (it already has the latest price) exists.
-- Backup of the removed rows: 2026-10-28-merged-duplicates.json (undo: ...-restore.sql).
with plan(drop_id, keep_id) as (values
  ('17e4d4e2-8dbb-44e7-b5a8-8f93d4a4fbc3'::uuid, '43999b9e-d496-4f8e-adc1-240d62047075'::uuid), -- 1"XSCH80: A10 -> A5 1.50
  ('6c604845-6acd-4e8f-a4b7-263fa88bd0cb', 'b9b02cea-a3f3-475a-b3d6-5cd50721eca8'), -- 11/2"XSCH160: no Item No. -> C11 6.20
  ('47ac14d2-22ac-4a17-a701-55cff7d37efe', '72c91cb7-4bc3-43d4-b4fe-54c72e9bbf49'), -- 11/4"XSCH160: no Item No. -> C11 4.50
  ('9084873b-8928-4a14-8695-5368a81d2a17', '26586235-bb16-47fd-9e57-8b4b063f0b14'), -- 14"XSTD: no Item No. -> M6 227.00
  ('c1096203-d161-4238-83d8-112be6873640', 'c8d52a9f-f14a-4ba2-8b98-3e29ea4c19be'), -- 16"X12"XSTD REDUCER CONCENTRIC: no Item No. -> X81 145.00
  ('30a41fc0-ef87-4bc3-baf3-3c77ada270b4', '8c4f85e5-a501-4002-ac25-514a81474130'), -- 2"XSCH160: no Item No. -> D16 9.00
  ('801b6be0-1f76-494b-bbed-8cd8ca347cea', 'f903e556-7c52-4362-a0c8-e57384271845'), -- 219XSCH40: no Item No. -> J7 64.00
  ('b5f99136-322a-43c2-8532-576a61383080', 'ac823f36-e5cc-4f6f-aca3-18ec7c9d4023'), -- 273X5.75MM 700MM: K25 -> K2 62.00
  ('0c435d29-758b-4d6f-b84a-48b5079df35f', 'dddadc5b-630c-4b76-b346-1a0c27646314'), -- 325X5MM 840MM: L2 -> L32 82.00
  ('198c6c1e-8f07-449f-b470-1b1178bbc819', 'd7f62b58-1330-4fac-b39d-e7f949fa69a1'), -- 355X5.75MM: no Item No. -> M4 173.00
  ('ebf638bf-7769-45d1-87b6-8764d3b080f9', '323980c0-87b7-4b7e-b225-fe543c91e736'), -- 42X4MM 95MM: B2 -> B3 1.03
  -- Added 2026-10-29 (user approved): FPP226 lists it twice; 3.60 is 2.03 RMB/kg, 8.20 matches the other 45° elbows.
  ('5d09fe0e-5e42-40b2-8190-93649fb58343', 'd6df58cd-071d-4cf0-9c9d-5f8b2f963246')  -- 4"XSTD 45°: no Item No. 3.60 -> F13 8.20
)
delete from public.inventory_items i
using plan p
where i.id = p.drop_id
  and exists (select 1 from public.inventory_items k where k.id = p.keep_id)
returning coalesce(i.item_code, '(no Item No.)') as removed_code, i.description, i.note, i.unit_price;
