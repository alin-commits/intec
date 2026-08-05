insert into public.business_units (name, slug, brand_color, logo_url, is_active) values
  ('Suministros Intec', 'suministros-intec', '#2563EB', '/logo-intec.webp', true),
  ('BlizzCool', 'blizzcool', '#0891B2', '/logo-blizzcool.webp', true),
  ('Sumifluid', 'sumifluid', '#7C3AED', '/logo-sumifluid.webp', true),
  ('Jender', 'jender', '#EA580C', '/logo-jender.webp', true),
  -- Sin actividad comercial por ahora: se conservan pero no aparecen
  -- en registro de consultas ni en comparativas activas (is_active = false).
  ('CST Ibérica', 'cst-iberica', '#16A34A', null, false),
  ('Blizztherm', 'blizztherm', '#DC2626', null, false)
on conflict (slug) do nothing;
