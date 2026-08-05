-- Amplía los canales de consulta de web/phone a los 5 canales reales que ya
-- se controlaban a mano en el Excel de seguimiento (Teléfono, Chat,
-- Email/Formulario, Whatsapp, Portales/RRSS).
--
-- Es una migración puramente aditiva: se añaden valores nuevos al enum
-- existente `public.inquiry_type`, sin tocar la tabla `inquiries`, sus
-- índices ni sus políticas RLS. El valor histórico 'web' se conserva en el
-- enum (Postgres no permite eliminar valores de un enum) pero deja de
-- utilizarse: la aplicación ya no lo escribe, y el desglose "web" pasa a
-- calcularse como la suma de chat + email_form + whatsapp + portal_rrss.

alter type public.inquiry_type add value if not exists 'chat';
alter type public.inquiry_type add value if not exists 'email_form';
alter type public.inquiry_type add value if not exists 'whatsapp';
alter type public.inquiry_type add value if not exists 'portal_rrss';
