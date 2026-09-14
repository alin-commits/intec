-- El campo "teléfono de empresa" se cambia por "ciudad o población" en el
-- listado del CRM; se reutiliza la misma columna en vez de crear una nueva
-- (no había datos reales guardados ahí todavía).
alter table public.crm_contacts
  rename column company_phone to city;
