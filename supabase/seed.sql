insert into public.business_units (name, slug, brand_color) values
  ('Suministros Intec', 'suministros-intec', '#2563EB'),
  ('BlizzCool', 'blizzcool', '#0891B2'),
  ('Sumifluid', 'sumifluid', '#7C3AED'),
  ('Jender', 'jender', '#EA580C'),
  ('CST Ibérica', 'cst-iberica', '#16A34A'),
  ('Blizztherm', 'blizztherm', '#DC2626')
on conflict (slug) do nothing;
