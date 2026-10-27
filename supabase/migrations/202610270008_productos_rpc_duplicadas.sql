-- Quitar las dos funciones de productos que quedaron por duplicado.
--
-- La migración 202610220009 (productos-por-comercial) añadió p_reps a
-- sage_article_groups y sage_article_summary, y empezaba borrando las
-- versiones de antes. En la base están las dos, así que el drop no llegó a
-- correr o alguien volvió a aplicar la migración anterior encima.
--
-- Con las dos ahí, PostgREST no puede elegir y responde 300 PGRST203 a toda
-- llamada que no mande p_reps:
--
--   Could not choose the best candidate function between:
--     sage_article_groups(p_group, p_from, p_to, p_companies, p_families, p_cost_from, p_months)
--     sage_article_groups(..., p_reps)
--
-- Efecto en el panel: en Productos, las subfamilias, las marcas y los
-- artículos salían vacíos («Sin subfamilias con venta en este periodo»)
-- siempre que no hubiera un comercial marcado, que es el caso normal. Las
-- familias no, porque sage_family_summary sí quedó con una sola versión.
--
-- El panel ya manda p_reps siempre, así que esto no es lo que lo arregla:
-- esto quita la de antes para que nadie la llame por error y para que el
-- siguiente que mire el catálogo de funciones no vea dos.

drop function if exists public.sage_article_groups(text, date, date, smallint[], text[], date, text[]);
drop function if exists public.sage_article_summary(date, date, smallint[], text[], text, text, integer, date, text[]);
