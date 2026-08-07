import { z } from "zod";

const optionalTrimmed = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null),
    z.string().max(max).nullable(),
  );

const booleanFlag = z.preprocess((value) => value === "true" || value === true, z.boolean());

export const ticketSubmissionSchema = z
  .object({
    reporterName: z.string().trim().min(2, "Indica tu nombre completo.").max(120),
    reporterPhone: z.string().trim().min(6, "Indica un teléfono válido.").max(30),
    reporterEmail: z.preprocess(
      (value) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null),
      z.string().email("El correo no es válido.").nullable(),
    ),
    department: z.string().trim().min(2, "Indica tu departamento.").max(80),
    title: z.string().trim().min(3, "Indica un título breve.").max(150),
    category: z.enum(["erp_apps", "equipment", "accounts_access", "network"], "Selecciona una categoría."),
    description: z.string().trim().min(10, "Describe el problema con un poco más de detalle.").max(4000),
    startedAt: optionalTrimmed(120),
    blockingLevel: z.enum(["blocked", "hindered", "not_blocked"], "Selecciona el nivel de bloqueo."),
    restarted: booleanFlag,
    hasErrorMessage: booleanFlag,
    errorMessage: optionalTrimmed(2000),
    honeypot: z.string().max(0, "Envío no válido."),
  })
  .transform((data) => ({
    ...data,
    errorMessage: data.hasErrorMessage ? data.errorMessage : null,
  }));

export type TicketSubmission = z.infer<typeof ticketSubmissionSchema>;
