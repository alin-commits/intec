-- La página pública de una tarjeta de visita (/tarjeta/<slug>) hace un join
-- con business_units para el logo y el nombre. La política existente
-- (business_units_read_authenticated) solo permite "authenticated", así que
-- un visitante anónimo (el uso real del enlace/QR) no podía leer la unidad
-- y la tarjeta salía como "no encontrada". Solo expone columnas ya públicas
-- (nombre, slug, logo, color de marca), igual que business_cards_public_select.

create policy business_units_public_select on public.business_units
for select to anon using (is_active = true);
