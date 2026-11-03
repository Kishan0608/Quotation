-- The commission box takes any value (user, 2026-11-02): 25%, or x 25 (= 2,400%), or more.
-- Before, the database refused anything above 1,000%. Only the floor stays: -100% (x 0),
-- so a price can never go below zero. The column type numeric(7,2) still caps it at
-- 99,999.99% (x 1,001), far above any real commission.
alter table public.quotations drop constraint if exists quotations_margin_pct_check;
alter table public.quotations add constraint quotations_margin_pct_check check (margin_pct >= -100);

alter table public.company_settings drop constraint if exists company_settings_default_margin_pct_check;
alter table public.company_settings add constraint company_settings_default_margin_pct_check check (default_margin_pct >= -100);
