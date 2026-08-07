-- Lets admin log direct sales attributed to a campaign that never went
-- through the leads pipeline, alongside the existing leads-derived stats.
alter table campaigns add column direct_sales_count integer not null default 0;
alter table campaigns add column direct_sale_value numeric(12, 2) not null default 0;
