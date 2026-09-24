// Input rules for the vault. The browser validates for comfort; this is the
// validation that actually counts, because it runs on the server.
import { z } from "zod";

/** Only http(s) links are stored: `javascript:` and friends never reach the UI. */
export const vaultUrl = z
  .string()
  .trim()
  .max(2048)
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value.includes("://") ? value : `https://${value}`);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }, "La dirección web no es válida.")
  .transform((value) => (value && !value.includes("://") ? `https://${value}` : value));

const name = z.string().trim().min(1, "Ponle un nombre a la credencial.").max(160);
const username = z.string().trim().max(160).transform((value) => value || null);
const secret = z.string().min(1, "La contraseña no puede estar vacía.").max(4096);
const notes = z.string().max(20000).transform((value) => (value.trim() === "" ? null : value)).nullable();
const tags = z.array(z.string().trim().min(1).max(30)).max(10);
const visibility = z.enum(["shared", "personal", "restricted"]);
const entryType = z.enum(["plain", "email", "server", "bank", "other"]);
const optionalId = z.string().uuid().nullable();

export const createEntrySchema = z.object({
  name,
  url: vaultUrl.default(null),
  username: username.default(null),
  password: secret,
  notes: notes.default(null),
  categoryId: optionalId.default(null),
  businessUnitId: optionalId.default(null),
  visibility: visibility.default("shared"),
  entryType: entryType.default("plain"),
  tags: tags.default([]),
});

export const updateEntrySchema = z.object({
  name: name.optional(),
  url: vaultUrl.optional(),
  username: username.optional(),
  /** Absent means "leave the stored password alone": it is never decrypted to re-encrypt it. */
  password: secret.optional(),
  notes: notes.optional(),
  categoryId: optionalId.optional(),
  businessUnitId: optionalId.optional(),
  visibility: visibility.optional(),
  entryType: entryType.optional(),
  tags: tags.optional(),
});

export const revealSchema = z.object({
  field: z.enum(["password", "notes"]).default("password"),
  /** "copy" is recorded as PASSWORD_COPY so the audit log tells both apart. */
  intent: z.enum(["view", "copy"]).default("view"),
});

export const permissionSchema = z.object({
  userId: z.string().uuid(),
  canView: z.boolean().default(true),
  canEdit: z.boolean().default(false),
  canDelete: z.boolean().default(false),
  canManagePermissions: z.boolean().default(false),
});

export type CreateEntryInput = z.infer<typeof createEntrySchema>;
export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;
