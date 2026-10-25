-- "Naveen.xlsx" (FPP248 CN3#NAVEEN 8th shipment): items already in inventory only get their price
-- updated (last price in the file wins); new items are added, one row each, in Excel order.
with f(ord, item_code, description, weight_kg, unit_price, stock_qty, loading_charges, actual_weight, note) as (values
(0, $t$M6$t$, $t$14"XSTD$t$, 63, 227::numeric, 15, 0, $t$8.3-9.0MM$t$, $t$Standard$t$),
(1, $t$N1$t$, $t$406X5MM$t$, 35, 148::numeric, 25, 20, $t$4.4-4.6MM$t$, $t$1150MM$t$),
(2, $t$M2$t$, $t$355X6MM$t$, 31.5, 124::numeric, 10, 8, $t$5.2-5.5MM$t$, $t$1000MM$t$),
(3, $t$L5$t$, $t$325X6.5MM$t$, 37, 130::numeric, 30, 28, $t$6.0-6.5MM$t$, $t$Standard$t$),
(4, $t$L2$t$, $t$325X5.75MM$t$, 24, 86.5::numeric, 26, 15, $t$5.2-5.5MM$t$, $t$840MM$t$),
(5, $t$K25$t$, $t$273X5MM$t$, 16.5, 61.5::numeric, 80, 32, $t$5.2-5.5MM$t$, $t$700MM$t$),
(6, $t$J1$t$, $t$219X4MM$t$, 6.8, 29::numeric, 158, 27, $t$3.5MM$t$, $t$560MM$t$),
(7, $t$J1$t$, $t$219X4MM$t$, 6.8, 28.6::numeric, 42, 0.2, $t$3.5MM$t$, $t$560MM$t$),
(8, $t$C3$t$, $t$48X4MM$t$, 0.28, 1.13::numeric, 5100, 0, $t$3.3-3.5MM$t$, $t$115MM$t$),
(9, $t$D3$t$, $t$60X4MM$t$, 0.43, 1.8::numeric, 5040, 0, $t$3.4-3.5MM$t$, $t$145MM$t$),
(10, $t$E3$t$, $t$89X4.25MM$t$, 1.15, 4.55::numeric, 2211, 0.05, $t$3.8-4.0MM$t$, $t$225MM$t$),
(11, $t$B1$t$, $t$42X2.5MM$t$, 0.14, 0.82::numeric, 3000, 11, $t$2.4-2.5MM$t$, $t$95MM$t$),
(12, $t$C5$t$, $t$11/2"XSCH80$t$, 0.45, 2.4::numeric, 1500, 0, $t$4.5-4.7MM$t$, $t$Standard$t$),
(13, $t$H2$t$, $t$165X4.75MM$t$, 5, 18.9::numeric, 1039, 130.1, $t$4.5-4.6MM$t$, $t$440MM$t$),
(14, $t$F1$t$, $t$114X3.5MM$t$, 1.65, 6.7::numeric, 2200, 85, $t$3.3-3.5MM$t$, $t$300MM$t$),
(15, $t$G1$t$, $t$140X3.5MM$t$, 2.6, 10.4::numeric, 300, 20, $t$3.4-3.6MM$t$, $t$370MM$t$),
(16, $t$G4$t$, $t$5"XSCH40$t$, 5.7, 23.5::numeric, 310, 0, $t$5.7-6.2MM$t$, $t$Standard$t$),
(17, $t$V4$t$, $t$1/2"XSCH40 TEE$t$, 0.1, 1.6::numeric, 800, 2, $t$2.7-2.8MM / 2.5-2.6MM$t$, null),
(18, $t$A6$t$, $t$1"XSCH40 TEE$t$, 0.3, 2.3::numeric, 800, 6, $t$3.3-3.5MM / 3.0-3.2MM$t$, null),
(19, $t$B6$t$, $t$11/4"XSCH40 TEE$t$, 0.4, 3.3::numeric, 300, 3, $t$3.5-3.7MM / 3.3-3.5MM$t$, null),
(20, $t$C6$t$, $t$11/2"XSCH40 TEE$t$, 0.62, 4.1::numeric, 600, 9, $t$3.5-3.6MM / 3.3-3.4MM$t$, null),
(21, $t$L14$t$, $t$12"XSTD TEE$t$, 37, 185::numeric, 15, 14, $t$8.3-9.0MM / 8.3-9.0MM$t$, null),
(22, $t$F5$t$, $t$114XSCH40 OIL PIPE$t$, 3.3, 11.3::numeric, 300, 0, $t$5.2-5.5MM$t$, $t$Standard$t$),
(23, $t$P1$t$, $t$457X5.8MM$t$, 56, 243::numeric, 16, 0, $t$5.4-5.5MM$t$, $t$1280MM$t$),
(24, $t$Q1$t$, $t$508X5.8MM$t$, 72, 302::numeric, 16, 0, $t$5.4-5.5MM$t$, $t$1450MM$t$),
(25, $t$N2$t$, $t$406X6MM$t$, 44, 173::numeric, 16, 18, $t$5.2-5.5MM$t$, $t$1150MM$t$),
(26, $t$M1$t$, $t$355X5MM$t$, 24, 108::numeric, 16, 10, $t$4.4-4.5MM$t$, $t$1000MM$t$),
(27, $t$J2$t$, $t$219X5MM$t$, 8.8, 39::numeric, 200, 44, $t$4.4-4.7MM$t$, $t$560MM$t$),
(28, $t$L7$t$, $t$12"XSTD$t$, 50, 173::numeric, 35, 0, $t$8.3-9.0MM$t$, $t$Standard$t$),
(29, $t$K7$t$, $t$273XSCH40$t$, 32, 121::numeric, 70, 0, $t$8.1-9.0MM$t$, $t$Standard$t$),
(30, $t$L1$t$, $t$325X4MM$t$, 16.2, 69::numeric, 29, 0, $t$3.8-4.0MM$t$, $t$840MM$t$),
(31, $t$B5$t$, $t$11/4"XSCH80$t$, 0.3, 1.95::numeric, 1200, 9, $t$4.3-4.5MM$t$, $t$Standard$t$),
(32, $t$C1$t$, $t$48X2.5MM$t$, 0.2, 1::numeric, 6000, 30, $t$2.4-2.5MM$t$, $t$115MM$t$),
(33, $t$D2$t$, $t$60X2.5MM$t$, 0.3, 1.53::numeric, 4000, 30, $t$2.4-2.5MM$t$, $t$145MM$t$),
(34, $t$E1$t$, $t$89X3MM$t$, 0.9, 3.7::numeric, 2000, 45, $t$2.9-3.0MM$t$, $t$225MM$t$),
(35, $t$H1$t$, $t$165X3.75MM$t$, 4, 14.3::numeric, 919, 90.7, $t$3.5-3.6MM$t$, $t$440MM$t$),
(36, $t$G2$t$, $t$140X5MM$t$, 3.5, 13::numeric, 250, 20, $t$3.4-3.5MM$t$, $t$370MM$t$),
(37, $t$H4$t$, $t$6"XSCH40$t$, 9, 34.5::numeric, 200, 45, $t$6.2-6.5MM$t$, $t$Standard$t$),
(38, $t$H5$t$, $t$6"XSCH80$t$, 14.7, 61::numeric, 60, 22, $t$9.6-10.3MM$t$, $t$Standard$t$),
(39, $t$F6$t$, $t$4"XSCH80$t$, 5, 22.8::numeric, 200, 25, $t$7.5-8.0MM$t$, $t$Standard$t$),
(40, $t$F5$t$, $t$114XSCH40 OIL PIPE$t$, 3.3, 11.3::numeric, 400, 0, $t$5.2-5.5MM$t$, $t$Standard$t$),
(41, $t$D4$t$, $t$2"XSCH40$t$, 0.6, 2.85::numeric, 1050, 0.5, $t$3.5-4.0MM$t$, $t$Standard$t$),
(42, $t$F3$t$, $t$114X4.75MM$t$, 2.3, 8.7::numeric, 1800, 100, $t$4.5-4.6MM$t$, $t$300MM$t$)),
fk as (select f.*, upper(regexp_replace(coalesce(item_code, ''), '[[:space:]()（）]', '', 'g')) || '|' || upper(regexp_replace(description, '[[:space:]()（）]', '', 'g')) as key from f),
ik as (select i.id, i.unit_price, upper(regexp_replace(coalesce(i.item_code, ''), '[[:space:]()（）]', '', 'g')) || '|' || upper(regexp_replace(i.description, '[[:space:]()（）]', '', 'g')) as key from public.inventory_items i),
-- last price in the file for each item
lp as (select distinct on (key) key, unit_price from fk where unit_price is not null order by key, ord desc),
-- first row of each item that is not in inventory yet
nw as (select distinct on (fk.key) fk.* from fk where not exists (select 1 from ik where ik.key = fk.key) order by fk.key, fk.ord),
upd as (
  update public.inventory_items i set unit_price = lp.unit_price
  from ik join lp on lp.key = ik.key
  where i.id = ik.id and i.unit_price is distinct from lp.unit_price
  returning i.id
),
ins as (
  insert into public.inventory_items (item_code, description, weight_kg, unit_price, stock_qty, loading_charges, actual_weight, note, created_at)
  select nw.item_code, nw.description, nw.weight_kg, coalesce(lp.unit_price, nw.unit_price), nw.stock_qty, nw.loading_charges, nw.actual_weight, nw.note,
         now() + make_interval(secs => nw.ord / 1000.0)
  from nw left join lp on lp.key = nw.key
  order by nw.ord
  returning id
)
select (select count(*) from upd) as price_rows_updated, (select count(*) from ins) as items_added;
