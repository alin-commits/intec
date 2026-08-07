"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ticketBlockingLevelLabels, ticketBlockingLevelOrder, ticketCategoryLabels, ticketCategoryOrder } from "@/lib/tickets/constants";
import type { TicketBlockingLevel, TicketCategory } from "@/lib/tickets/types";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const ALLOWED_FILE_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);

export function TicketForm() {
  const router = useRouter();
  const [reporterName, setReporterName] = useState("");
  const [reporterPhone, setReporterPhone] = useState("");
  const [reporterEmail, setReporterEmail] = useState("");
  const [department, setDepartment] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<TicketCategory>("erp_apps");
  const [description, setDescription] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [blockingLevel, setBlockingLevel] = useState<TicketBlockingLevel>("hindered");
  const [restarted, setRestarted] = useState(false);
  const [hasErrorMessage, setHasErrorMessage] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function handleFileChange(fileList: FileList | null) {
    setFileError(null);
    if (!fileList || fileList.length === 0) {
      setAttachments([]);
      return;
    }
    const files = Array.from(fileList);
    if (files.length > MAX_ATTACHMENTS) {
      setFileError(`Puedes adjuntar como máximo ${MAX_ATTACHMENTS} archivos.`);
      setAttachments([]);
      return;
    }
    for (const file of files) {
      if (!ALLOWED_FILE_TYPES.has(file.type)) {
        setFileError("Los archivos deben ser JPG, PNG o PDF.");
        setAttachments([]);
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        setFileError("Cada archivo debe pesar como máximo 5 MB.");
        setAttachments([]);
        return;
      }
    }
    setAttachments(files);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      const formData = new FormData();
      formData.set("reporterName", reporterName);
      formData.set("reporterPhone", reporterPhone);
      formData.set("reporterEmail", reporterEmail);
      formData.set("department", department);
      formData.set("title", title);
      formData.set("category", category);
      formData.set("description", description);
      formData.set("startedAt", startedAt);
      formData.set("blockingLevel", blockingLevel);
      formData.set("restarted", String(restarted));
      formData.set("hasErrorMessage", String(hasErrorMessage));
      formData.set("errorMessage", hasErrorMessage ? errorMessage : "");
      formData.set("honeypot", "");
      for (const file of attachments) formData.append("attachments", file);

      const response = await fetch("/api/tickets/create", { method: "POST", body: formData });
      const result = await response.json() as { ok?: boolean; ticketNumber?: string; error?: string };
      if (!response.ok || !result.ok || !result.ticketNumber) {
        throw new Error(result.error || "No se pudo registrar la incidencia.");
      }
      router.push(`/soporte/enviado?ticket=${encodeURIComponent(result.ticketNumber)}`);
    } catch (cause) {
      // /api/tickets/create ya devuelve mensajes seguros y en español (validación,
      // límites de archivo...); aquí solo cubrimos errores de red inesperados.
      setFormError(cause instanceof Error ? cause.message : "No se pudo enviar la incidencia. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={handleSubmit}>
      {/* Honeypot: hidden from real users, bots tend to fill every field they find. */}
      <div style={{ position: "absolute", left: "-9999px" }} aria-hidden="true">
        <label>No rellenar<input tabIndex={-1} autoComplete="off" name="honeypot" /></label>
      </div>

      <label><span>Nombre y apellidos *</span><input value={reporterName} onChange={(event) => setReporterName(event.target.value)} required maxLength={120} /></label>
      <label><span>Teléfono *</span><input type="tel" value={reporterPhone} onChange={(event) => setReporterPhone(event.target.value)} required maxLength={30} /></label>
      <label><span>Correo electrónico</span><input type="email" value={reporterEmail} onChange={(event) => setReporterEmail(event.target.value)} maxLength={160} /></label>
      <label><span>Departamento *</span><input value={department} onChange={(event) => setDepartment(event.target.value)} required maxLength={80} /></label>

      <label className="form-field-wide"><span>Título breve *</span><input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={150} placeholder="Ej. No puedo acceder al correo" /></label>

      <label><span>Categoría *</span>
        <select value={category} onChange={(event) => setCategory(event.target.value as TicketCategory)} required>
          {ticketCategoryOrder.map((value) => <option key={value} value={value}>{ticketCategoryLabels[value]}</option>)}
        </select>
      </label>
      <label><span>Nivel de bloqueo *</span>
        <select value={blockingLevel} onChange={(event) => setBlockingLevel(event.target.value as TicketBlockingLevel)} required>
          {ticketBlockingLevelOrder.map((value) => <option key={value} value={value}>{ticketBlockingLevelLabels[value]}</option>)}
        </select>
      </label>

      <label className="form-field-wide"><span>Descripción detallada *</span><textarea rows={5} value={description} onChange={(event) => setDescription(event.target.value)} required maxLength={4000} /></label>

      <label><span>¿Desde cuándo ocurre?</span><input value={startedAt} onChange={(event) => setStartedAt(event.target.value)} maxLength={120} placeholder="Ej. Desde esta mañana" /></label>
      <label><span>¿Has reiniciado el equipo o la aplicación?</span>
        <select value={restarted ? "true" : "false"} onChange={(event) => setRestarted(event.target.value === "true")}>
          <option value="false">No</option>
          <option value="true">Sí</option>
        </select>
      </label>

      <label><span>¿Aparece algún mensaje de error?</span>
        <select value={hasErrorMessage ? "true" : "false"} onChange={(event) => setHasErrorMessage(event.target.value === "true")}>
          <option value="false">No</option>
          <option value="true">Sí</option>
        </select>
      </label>
      {hasErrorMessage ? (
        <label><span>Texto del mensaje de error</span><input value={errorMessage} onChange={(event) => setErrorMessage(event.target.value)} maxLength={2000} /></label>
      ) : null}

      <label className="form-field-wide"><span>Archivos o capturas (opcional, hasta 5, JPG/PNG/PDF, máx. 5 MB cada uno)</span>
        <input type="file" multiple accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" onChange={(event) => handleFileChange(event.target.files)} />
      </label>
      {fileError ? <div className="form-error form-field-wide" role="alert">{fileError}</div> : null}

      {formError ? <div className="form-error form-field-wide" role="alert">{formError}</div> : null}

      <div className="form-field-wide modal-actions" style={{ justifyContent: "flex-start" }}>
        <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Enviando…" : "Enviar incidencia"}</button>
      </div>
    </form>
  );
}
