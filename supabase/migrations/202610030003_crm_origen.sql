-- De dónde viene cada contacto del CRM: un evento, una feria, la web, una
-- recomendación… Texto libre, para poder poner el nombre concreto del evento
-- ("Feria Climatización 2026"); la pantalla sugiere los que ya se han usado.

alter table public.crm_contacts add column if not exists origin text;

comment on column public.crm_contacts.origin is
  'De dónde viene el contacto (evento, feria, web, recomendación…). Texto libre.';
