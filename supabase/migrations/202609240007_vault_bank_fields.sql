-- Campos propios de las credenciales de banco.
--
-- Una ficha de banco tiene datos que el resto no: el banco, el titular, el
-- número de cuenta, el IBAN. Hasta ahora acababan mezclados en las notas.
--
-- Van sin cifrar a propósito: no son secretos (el IBAN y el titular están en
-- cada factura que emitís) y así se pueden ver de un vistazo y buscar por
-- ellos. Lo que sí es secreto -el PIN, la clave de firma- sigue donde estaba:
-- en el campo de contraseña y en las notas, cifrado.
--
-- Solo las fichas marcadas como banco usan esta columna; en las demás es nula.

alter table public.vault_entries
  add column if not exists bank_details jsonb;

comment on column public.vault_entries.bank_details is
  'Datos del banco (nombre, código, titular, cuenta, IBAN) de las fichas de tipo bank. Nunca contiene contraseñas ni PIN.';
