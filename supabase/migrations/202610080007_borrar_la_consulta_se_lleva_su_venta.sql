-- Borrar una consulta se lleva su venta.
--
-- El enlace de la venta con la consulta era de los primeros que se escribieron
-- y decía "on delete set null": al borrar la consulta, el apunte se quedaba
-- con su inquiry_id a nulo. Eso ya no cuela, porque la forma del apunte exige
-- que uno de modo 'inquiry' tenga su consulta: el borrado fallaba con un error
-- de restricción (23514) que no le dice nada a quien lo ve.
--
-- Antes casi no se notaba —había que haber apuntado una venta a mano—, pero
-- ahora toda consulta en oferta, ganada o perdida tiene la suya, así que
-- cualquiera que borre una consulta se lo encuentra.
--
-- Se arregla como en los leads y en el CRM, que ya lo hacen así: la venta vive
-- colgada de su ficha y se va con ella.
--
-- Se busca la clave por el catálogo en vez de por su nombre, para no dejar dos
-- enlaces si en algún entorno se llamara de otra forma.
--
-- Se puede volver a ejecutar sin romper nada.

do $$
declare
  v_name text;
begin
  for v_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'sales_entries'
      and con.contype = 'f'
      and con.conkey = array[(
        select att.attnum from pg_attribute att
        where att.attrelid = rel.oid and att.attname = 'inquiry_id'
      )]
  loop
    execute format('alter table public.sales_entries drop constraint %I', v_name);
  end loop;
end
$$;

alter table public.sales_entries
  add constraint sales_entries_inquiry_id_fkey
  foreign key (inquiry_id) references public.inquiries (id) on delete cascade;
