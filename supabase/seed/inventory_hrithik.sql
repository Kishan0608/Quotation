-- "HRITHIK.xlsx (FPP246 HRITHIK 2nd shipment)": items already in inventory only get their price updated
-- (last price in the file wins); new items are added, one row each, in Excel order.
with f(ord, item_code, description, weight_kg, unit_price, stock_qty, loading_charges, actual_weight, note) as (values
(0, $t$C1$t$, $t$48X2.5MM$t$, 0.2, 0.99::numeric, 2550, 13.5, $t$2.4-2.5MM$t$, $t$115MM$t$),
(1, $t$E1$t$, $t$89X3MM$t$, 0.9, 3.7::numeric, 4000, 90, $t$2.9-3.0MM$t$, $t$225MM$t$),
(2, $t$B1$t$, $t$42X2.5MM$t$, 0.14, 0.82::numeric, 3000, 10, $t$2.4-2.5MM$t$, $t$95MM$t$),
(3, $t$D3$t$, $t$60X4MM$t$, 0.45, 1.8::numeric, 6000, 0, $t$3.4-3.5MM$t$, $t$145MM$t$),
(4, $t$U2$t$, $t$76X4MM$t$, 0.78, 3.5::numeric, 2400, 0, $t$3.7-4.0MM$t$, $t$190MM$t$),
(5, $t$F5$t$, $t$114XSCH40(OIL PIPE)$t$, 3.2, 11.4::numeric, 50, 0, $t$5.2-5.5MM$t$, $t$Standard$t$),
(6, $t$F5$t$, $t$114XSCH40(OIL PIPE)$t$, 3.2, 11.3::numeric, 450, 0, $t$5.2-5.5MM$t$, $t$Standard$t$),
(7, $t$F1$t$, $t$114X3.5MM$t$, 1.65, 6.7::numeric, 1906, 78, $t$3.3-3.5MM$t$, $t$300MM$t$),
(8, $t$H1$t$, $t$165X3.75MM$t$, 4, 14.3::numeric, 636, 64, $t$3.5-3.6MM$t$, $t$440MM$t$),
(9, $t$G2$t$, $t$140X5MM$t$, 3.4, 13::numeric, 50, 4, $t$4.4-4.6MM$t$, $t$370MM$t$),
(10, $t$H2$t$, $t$165X4.75MM$t$, 5, 18.9::numeric, 300, 37, $t$4.5-4.6MM$t$, $t$440MM$t$),
(11, $t$G2$t$, $t$140X5MM$t$, 3.4, 13::numeric, 250, 0, $t$4.4-4.6MM$t$, $t$370MM$t$),
(12, $t$H2$t$, $t$165X4.75MM$t$, 5, 18.9::numeric, 200, 0, $t$3.5-3.6MM$t$, $t$440MM$t$),
(13, $t$K2$t$, $t$273X5.75MM$t$, 16.5, 61::numeric, 70, 29, $t$5.2-5.5MM$t$, $t$700MM$t$),
(14, $t$L2$t$, $t$325X5.75MM$t$, 24, 86.5::numeric, 15, 9.5, $t$5.2-5.5MM$t$, $t$840MM$t$),
(15, $t$J7$t$, $t$219XSCH40$t$, 18, 64::numeric, 162, 0, $t$7.2-8.0MM$t$, $t$Standard$t$),
(16, $t$L7$t$, $t$12"XSTD$t$, 50, 170::numeric, 20, 0, $t$8.3-9.0MM$t$, $t$Standard$t$),
(17, $t$K7$t$, $t$273XSCH40$t$, 33, 121::numeric, 40, 0, $t$8.1-8.8MM$t$, $t$Standard$t$),
(18, $t$L2$t$, $t$325X5.75MM$t$, 24, 87::numeric, 11, 0, $t$5.2-5.5MM$t$, $t$840MM$t$),
(19, $t$J1$t$, $t$219X4MM$t$, 6.8, 28.6::numeric, 50, 0, $t$3.5MM$t$, $t$560MM$t$),
(20, $t$B2$t$, $t$42X4MM$t$, 0.18, 1.02::numeric, 2000, 9, $t$3.2-3.5MM$t$, $t$95MM$t$),
(21, $t$D2$t$, $t$60X2.5MM$t$, 0.3, 1.53::numeric, 1400, 10, $t$2.4-2.5MM$t$, $t$145MM$t$),
(22, $t$U1$t$, $t$76X2.5MM$t$, 0.52, 2.45::numeric, 2580, 34, $t$2.4-2.5MM$t$, $t$190MM$t$),
(23, $t$C3$t$, $t$48X4MM$t$, 0.26, 1.13::numeric, 5100, 33, $t$3.3-3.5MM$t$, $t$115MM$t$),
(24, $t$D3$t$, $t$60X4MM$t$, 0.45, 1.8::numeric, 1600, 0, $t$3.4-3.5MM$t$, $t$145MM$t$),
(25, $t$C4$t$, $t$11/2"XSCH40$t$, 0.3, 1.58::numeric, 2040, 0, $t$3.3-3.5MM$t$, $t$Standard$t$),
(26, $t$C3$t$, $t$48X4MM$t$, 0.26, 1.13::numeric, 5100, 0, $t$3.3-3.5MM$t$, $t$115MM$t$),
(27, $t$D4$t$, $t$2"XSCH40 CTW$t$, 0.6, 2.65::numeric, 2005, 0.05, $t$3.4-4.0MM$t$, $t$Standard$t$),
(28, $t$E3$t$, $t$89X4.25MM$t$, 1.15, 4.55::numeric, 732, 0, $t$3.8-3.9MM$t$, $t$225MM$t$),
(29, $t$E3$t$, $t$89X4.25MM$t$, 1.15, 4.6::numeric, 2300, 0, $t$3.8-3.9MM$t$, $t$225MM$t$),
(30, $t$E4$t$, $t$89XSCH40(OIL PIPE)$t$, 2, 7.6::numeric, 1000, 0, $t$5.0-5.5MM$t$, $t$Standard$t$),
(31, $t$H2$t$, $t$165X4.75MM$t$, 5, 18.9::numeric, 23, 3, $t$4.5-4.6MM$t$, $t$440MM$t$),
(32, $t$F1$t$, $t$114X3.5MM$t$, 1.6, 6.7::numeric, 1694, 68, $t$3.3-3.5MM$t$, $t$300MM$t$),
(33, $t$H1$t$, $t$165X3.75MM$t$, 4, 14.3::numeric, 772, 66, $t$3.5-3.6MM$t$, $t$440MM$t$),
(34, $t$G1$t$, $t$140X3.5MM$t$, 2.4, 10.2::numeric, 353, 0.6, $t$3.3-3.5MM$t$, $t$370MM$t$),
(35, $t$J1$t$, $t$219X4MM$t$, 6.8, 28.6::numeric, 58, 0.8, $t$3.5MM$t$, $t$560MM$t$),
(36, $t$J7$t$, $t$219XSCH40$t$, 18, 64::numeric, 138, 0, $t$7.2-8.0MM$t$, $t$Standard$t$),
(37, $t$K7$t$, $t$273XSCH40$t$, 33, 121::numeric, 62, 0, $t$8.1-8.8MM$t$, $t$Standard$t$),
(38, $t$L2$t$, $t$325X5.75MM$t$, 24, 86.5::numeric, 92, 51, $t$5.2-5.5MM$t$, $t$840MM$t$),
(39, $t$K2$t$, $t$273X5.75MM$t$, 16.5, 61::numeric, 30, 12, $t$5.2-5.5MM$t$, $t$700MM$t$),
(40, $t$G4$t$, $t$5"XSCH40$t$, 5.7, 23.5::numeric, 100, 0, $t$5.7-6.2MM$t$, $t$Standard$t$)),
fk as (select f.*, upper(regexp_replace(coalesce(item_code, ''), '[[:space:]()（）]', '', 'g')) || '|' || upper(regexp_replace(description, '[[:space:]()（）]', '', 'g')) as key from f),
ik as (select i.id, i.unit_price, upper(regexp_replace(coalesce(i.item_code, ''), '[[:space:]()（）]', '', 'g')) || '|' || upper(regexp_replace(i.description, '[[:space:]()（）]', '', 'g')) as key from public.inventory_items i),
lp as (select distinct on (key) key, unit_price from fk where unit_price is not null order by key, ord desc),
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
