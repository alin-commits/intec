-- New roles for the password vault. Postgres does not allow a brand-new enum
-- value to be USED in the same transaction that adds it, so this migration only
-- adds the values and must be run before 202609240003_vault_schema.sql.
--
--   employee    : only sees Contraseñas (plus the IT ticket shortcut).
--   vault_admin : manages the vault (permissions and audit log).
--                 Being an app admin does NOT grant access to credentials.

alter type public.app_role add value if not exists 'employee';
alter type public.app_role add value if not exists 'vault_admin';
