-- Agencia: cada partida del presupuesto, marcada como SEO, SEM u otra cosa.
--
-- La inversión se quiere ver por separado —cuánto va a SEO y cuánto a SEM—,
-- aunque las consultas y el retorno sigan contando todo junto: una consulta
-- no dice si llegó por el SEO o por el SEM.
--
-- Las partidas que ya hay se clasifican por su concepto; a partir de ahora se
-- elige al apuntarlas.
--
-- Se puede volver a ejecutar sin romper nada.

alter table public.agency_budget_lines
  add column if not exists service text not null default 'otro';

alter table public.agency_budget_lines drop constraint if exists agency_budget_lines_service_check;
alter table public.agency_budget_lines
  add constraint agency_budget_lines_service_check check (service in ('seo', 'sem', 'otro'));

comment on column public.agency_budget_lines.service is
  'A qué va la partida: seo, sem (gestión de campañas y lo que se paga a Google Ads) u otro.';

-- Las de antes, por su concepto. Solo las que siguen en «otro»: si alguien ya
-- eligió, no se toca.
update public.agency_budget_lines
set service = case
  when concept ~* '\mseo\M|posicionamiento' then 'seo'
  when concept ~* '\msem\M|google ads|\mads\M|adwords|campañ|anuncio' then 'sem'
  else 'otro'
end
where service = 'otro';
