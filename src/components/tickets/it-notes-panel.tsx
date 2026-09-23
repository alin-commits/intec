"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Modal } from "@/components/ui/modal";
import { reportSafeError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import {
  cleanNoteContent,
  createBlock,
  formatFileSize,
  IT_NOTE_FILE_MAX_BYTES,
  IT_NOTES_BUCKET,
  isEffectivelyEmpty,
  isPdfFileName,
  itNoteCategoryLabels,
  itNoteCategoryOrder,
  mapItNoteFileRow,
  mapItNoteRow,
  noteFileStoragePath,
  noteSearchText,
  type ItNote,
  type ItNoteCategory,
  type ItNoteFile,
  type NoteBlock,
  type NoteExtraction,
} from "@/lib/tickets/notes";
import { EmptyState } from "./empty-state";
import { NoteBlocksEditor, NoteBlocksView } from "./note-blocks";

/** A file already uploaded to storage (to be read by the AI) but not yet linked to the note. */
type StagedFile = { path: string; fileName: string; sizeBytes: number };

type NoteDraft = {
  /** Null while the note hasn't been saved yet. */
  id: string | null;
  /** The id the note has or will get on insert, so files can be uploaded under it before saving. */
  noteId: string;
  title: string;
  category: ItNoteCategory;
  pinned: boolean;
  content: NoteBlock[];
  files: ItNoteFile[];
  removedFiles: ItNoteFile[];
  pendingFiles: File[];
  stagedFiles: StagedFile[];
};

type PdfSource = { file: File } | { path: string; fileName: string };

/** New notes start with the usual "problem → cause → solution" outline; any block can be removed. */
function templateBlocks(): NoteBlock[] {
  return [
    { ...createBlock("heading"), text: "Problema" } as NoteBlock,
    createBlock("text"),
    { ...createBlock("heading"), text: "Solución" } as NoteBlock,
    createBlock("steps"),
  ];
}

function draftFromNote(note: ItNote | null, files: ItNoteFile[]): NoteDraft {
  if (!note) return { id: null, noteId: crypto.randomUUID(), title: "", category: "solution", pinned: false, content: templateBlocks(), files: [], removedFiles: [], pendingFiles: [], stagedFiles: [] };
  return { id: note.id, noteId: note.id, title: note.title, category: note.category, pinned: note.pinned, content: note.content, files, removedFiles: [], pendingFiles: [], stagedFiles: [] };
}

/** Opens a short-lived link to a private file. The tab is opened first so popup blockers allow it. */
async function openNoteFile(path: string): Promise<boolean> {
  const tab = window.open("", "_blank");
  const { data, error } = await createClient().storage.from(IT_NOTES_BUCKET).createSignedUrl(path, 120);
  if (error || !data?.signedUrl) {
    tab?.close();
    return false;
  }
  if (tab) {
    tab.opener = null;
    tab.location.href = data.signedUrl;
  } else {
    window.location.href = data.signedUrl;
  }
  return true;
}

type NotesData =
  | { status: "missing" }
  | { status: "ready"; notes: ItNote[]; files: ItNoteFile[]; authors: Map<string, string> };

async function fetchNotesData(): Promise<NotesData> {
  const supabase = createClient();
  const [notesResult, filesResult] = await Promise.all([
    supabase.from("it_notes").select("id, title, category, content, pinned, created_by, updated_by, created_at, updated_at").order("updated_at", { ascending: false }),
    supabase.from("it_note_files").select("id, note_id, path, file_name, size_bytes, created_at").order("created_at"),
  ]);
  if (notesResult.error) {
    reportSafeError(notesResult.error, "");
    return { status: "missing" };
  }
  const notes = (notesResult.data ?? []).map((row) => mapItNoteRow(row as Record<string, unknown>));
  const files = (filesResult.data ?? []).map((row) => mapItNoteFileRow(row as Record<string, unknown>));
  const authorIds = Array.from(new Set(notes.flatMap((note) => [note.createdBy, note.updatedBy]).filter((id): id is string => Boolean(id))));
  let authors = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", authorIds);
    authors = new Map((profiles ?? []).map((row): [string, string] => [String(row.id), String(row.full_name ?? "")]));
  }
  return { status: "ready", notes, files, authors };
}

export function ItNotesPanel({ canManage, currentUserId, onMessage }: {
  canManage: boolean;
  currentUserId: string | null;
  onMessage: (message: string) => void;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "missing">("loading");
  const [notes, setNotes] = useState<ItNote[]>([]);
  const [files, setFiles] = useState<ItNoteFile[]>([]);
  const [authors, setAuthors] = useState<Map<string, string>>(new Map());
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ItNoteCategory | "all">("all");
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ItNote | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  // Latest draft for async work (the AI answer arrives after the user may have kept editing).
  const draftRef = useRef<NoteDraft | null>(null);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  function applyNotesData(data: NotesData) {
    if (data.status === "ready") {
      setNotes(data.notes);
      setFiles(data.files);
      setAuthors(data.authors);
    }
    setStatus(data.status);
  }

  async function loadNotes() {
    applyNotesData(await fetchNotesData());
  }

  useEffect(() => {
    let cancelled = false;
    fetchNotesData().then((data) => {
      if (!cancelled) applyNotesData(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const filesByNote = useMemo(() => {
    const map = new Map<string, ItNoteFile[]>();
    for (const file of files) map.set(file.noteId, [...(map.get(file.noteId) ?? []), file]);
    return map;
  }, [files]);

  const visibleNotes = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return notes
      .filter((note) => category === "all" || note.category === category)
      .filter((note) => {
        if (terms.length === 0) return true;
        const haystack = `${note.title} ${noteSearchText(note.content)} ${(filesByNote.get(note.id) ?? []).map((file) => file.fileName).join(" ")}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  }, [notes, category, query, filesByNote]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<ItNoteCategory, number>();
    for (const note of notes) counts.set(note.category, (counts.get(note.category) ?? 0) + 1);
    return counts;
  }, [notes]);

  const viewingNote = viewingId ? notes.find((note) => note.id === viewingId) ?? null : null;

  function openEditor(note: ItNote | null) {
    setDraft(draftFromNote(note, note ? filesByNote.get(note.id) ?? [] : []));
    setDraftDirty(false);
    setViewingId(null);
  }

  function updateDraft(patch: Partial<NoteDraft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setDraftDirty(true);
  }

  function closeEditor() {
    if (saving || aiBusy) return;
    if (draftDirty && !window.confirm("Hay cambios sin guardar. ¿Salir sin guardar?")) return;
    // PDFs uploaded only so the AI could read them are discarded with the draft.
    if (draft?.stagedFiles.length) void createClient().storage.from(IT_NOTES_BUCKET).remove(draft.stagedFiles.map((file) => file.path));
    const reopenId = draft?.id ?? null;
    setDraft(null);
    setViewingId(reopenId);
  }

  function removeStagedFile(staged: StagedFile) {
    void createClient().storage.from(IT_NOTES_BUCKET).remove([staged.path]);
    setDraft((current) => (current ? { ...current, stagedFiles: current.stagedFiles.filter((file) => file.path !== staged.path) } : current));
  }

  /** Sends a PDF to the AI and fills the draft with the note it writes. New files are uploaded first (staged). */
  async function fillFromPdf(noteId: string, source: PdfSource) {
    if (aiBusy) return;
    setAiBusy(true);
    const supabase = createClient();
    try {
      let path: string;
      let fileName: string;
      if ("file" in source) {
        const file = source.file;
        path = noteFileStoragePath(noteId, file.name);
        fileName = file.name.slice(0, 200);
        const { error: uploadError } = await supabase.storage.from(IT_NOTES_BUCKET).upload(path, file, { contentType: "application/pdf", upsert: false });
        if (uploadError) throw uploadError;
        const staged: StagedFile = { path, fileName, sizeBytes: file.size };
        setDraft((current) => (current ? { ...current, pendingFiles: current.pendingFiles.filter((item) => item !== file), stagedFiles: [...current.stagedFiles, staged] } : current));
        setDraftDirty(true);
      } else {
        path = source.path;
        fileName = source.fileName;
      }

      const response = await fetch("/api/it-notes/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, fileName }) });
      const payload = (await response.json().catch(() => ({}))) as { extraction?: NoteExtraction; error?: string };
      if (!response.ok || !payload.extraction) {
        onMessage(payload.error ?? "No se pudo leer el manual con la IA.");
        return;
      }
      const extraction = payload.extraction;
      const latest = draftRef.current;
      if (!latest || latest.noteId !== noteId) return;
      const replaced = isEffectivelyEmpty(latest.content);
      const hasTitle = Boolean(latest.title.trim());
      setDraft((current) => (current ? {
        ...current,
        title: hasTitle ? current.title : extraction.title,
        category: hasTitle ? current.category : extraction.category,
        content: replaced ? extraction.blocks : [...current.content, ...extraction.blocks],
      } : current));
      setDraftDirty(true);
      onMessage(replaced ? "La IA ha rellenado la nota. Revísala antes de guardar." : "La IA ha añadido el contenido del manual al final de la nota. Revísalo antes de guardar.");
    } catch (cause) {
      onMessage(reportSafeError(cause, "No se pudo leer el manual con la IA."));
    } finally {
      setAiBusy(false);
    }
  }

  function startNoteFromPdf(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    if (!isPdfFileName(file.name) && file.type !== "application/pdf") {
      onMessage("Elige un archivo PDF.");
      return;
    }
    if (file.size > IT_NOTE_FILE_MAX_BYTES) {
      onMessage("El PDF supera los 25 MB.");
      return;
    }
    const next = { ...draftFromNote(null, []), content: [], pendingFiles: [file] };
    setDraft(next);
    setDraftDirty(true);
    setViewingId(null);
    void fillFromPdf(next.noteId, { file });
  }

  function addPendingFiles(list: FileList | null) {
    if (!draft || !list) return;
    const accepted: File[] = [];
    for (const file of Array.from(list)) {
      if (file.size > IT_NOTE_FILE_MAX_BYTES) {
        onMessage(`«${file.name}» supera los 25 MB y no se ha añadido.`);
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length) updateDraft({ pendingFiles: [...draft.pendingFiles, ...accepted] });
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    addPendingFiles(event.dataTransfer.files);
  }

  async function saveDraft() {
    if (!draft || saving) return;
    const title = draft.title.trim();
    if (!title) {
      onMessage("Pon un título a la nota.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    try {
      const payload = { title: title.slice(0, 200), category: draft.category, pinned: draft.pinned, content: cleanNoteContent(draft.content), updated_by: currentUserId };
      let noteId = draft.id;
      if (noteId) {
        const { error } = await supabase.from("it_notes").update(payload).eq("id", noteId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("it_notes").insert({ ...payload, id: draft.noteId, created_by: currentUserId }).select("id").single();
        if (error) throw error;
        noteId = String(data.id);
      }

      if (draft.removedFiles.length > 0) {
        await supabase.storage.from(IT_NOTES_BUCKET).remove(draft.removedFiles.map((file) => file.path));
        const { error } = await supabase.from("it_note_files").delete().in("id", draft.removedFiles.map((file) => file.id));
        if (error) throw error;
      }

      const failed: string[] = [];
      for (const staged of draft.stagedFiles) {
        const { error: rowError } = await supabase.from("it_note_files").insert({ note_id: noteId, path: staged.path, file_name: staged.fileName, size_bytes: staged.sizeBytes });
        if (rowError) {
          reportSafeError(rowError, "");
          await supabase.storage.from(IT_NOTES_BUCKET).remove([staged.path]);
          failed.push(staged.fileName);
        }
      }
      for (const file of draft.pendingFiles) {
        const path = noteFileStoragePath(noteId, file.name);
        const { error: uploadError } = await supabase.storage.from(IT_NOTES_BUCKET).upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
        if (uploadError) {
          reportSafeError(uploadError, "");
          failed.push(file.name);
          continue;
        }
        const { error: rowError } = await supabase.from("it_note_files").insert({ note_id: noteId, path, file_name: file.name.slice(0, 200), size_bytes: file.size });
        if (rowError) {
          reportSafeError(rowError, "");
          await supabase.storage.from(IT_NOTES_BUCKET).remove([path]);
          failed.push(file.name);
        }
      }

      await loadNotes();
      setDraft(null);
      setDraftDirty(false);
      setViewingId(noteId);
      onMessage(failed.length ? `Nota guardada, pero no se pudieron subir: ${failed.join(", ")}.` : "Nota guardada.");
    } catch (cause) {
      onMessage(reportSafeError(cause, "No se pudo guardar la nota."));
    } finally {
      setSaving(false);
    }
  }

  async function togglePinned(note: ItNote) {
    const { error } = await createClient().from("it_notes").update({ pinned: !note.pinned }).eq("id", note.id);
    if (error) {
      onMessage(reportSafeError(error, "No se pudo fijar la nota."));
      return;
    }
    setNotes((current) => current.map((item) => (item.id === note.id ? { ...item, pinned: !note.pinned } : item)));
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const supabase = createClient();
      const paths = (filesByNote.get(pendingDelete.id) ?? []).map((file) => file.path);
      if (paths.length > 0) await supabase.storage.from(IT_NOTES_BUCKET).remove(paths);
      const { error } = await supabase.from("it_notes").delete().eq("id", pendingDelete.id);
      if (error) throw error;
      setNotes((current) => current.filter((note) => note.id !== pendingDelete.id));
      setFiles((current) => current.filter((file) => file.noteId !== pendingDelete.id));
      setViewingId(null);
      setPendingDelete(null);
      onMessage("Nota eliminada.");
    } catch (cause) {
      onMessage(reportSafeError(cause, "No se pudo eliminar la nota."));
    } finally {
      setDeleting(false);
    }
  }

  async function handleOpenFile(file: ItNoteFile) {
    const opened = await openNoteFile(file.path);
    if (!opened) onMessage("No se pudo abrir el archivo.");
  }

  function authorLabel(note: ItNote): string {
    const name = note.updatedBy ? authors.get(note.updatedBy) : undefined;
    return name ? `${formatDate(note.updatedAt)} · ${name}` : formatDate(note.updatedAt);
  }

  if (status === "loading") return <section className="panel notes-panel" />;

  if (status === "missing") {
    return (
      <div className="notice">
        <strong>Notas no disponibles todavía</strong>
        <span>Falta crear las tablas de notas en Supabase (migración 202609250001_it_knowledge_notes.sql).</span>
      </div>
    );
  }

  return (
    <>
      <section className="panel notes-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Base de conocimiento</span>
            <h2>Notas y manuales</h2>
            <p className="panel-subtitle">Soluciones a problemas habituales, procedimientos y manuales del equipo de informática.</p>
          </div>
          {canManage ? (
            <div className="panel-heading-trailing">
              <button type="button" className="button button-secondary" onClick={() => pdfInputRef.current?.click()}>✨ Nueva nota desde PDF</button>
              <button type="button" className="button button-primary" onClick={() => openEditor(null)}>+ Nueva nota</button>
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf,.pdf"
                hidden
                onChange={(event) => {
                  startNoteFromPdf(event.target.files);
                  event.target.value = "";
                }}
              />
            </div>
          ) : null}
        </div>

        <div className="notes-toolbar">
          <input
            type="search"
            className="notes-search"
            value={query}
            placeholder="Buscar en títulos, contenido y archivos…"
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="notes-category-chips" role="group" aria-label="Filtrar por tipo">
            <button type="button" className={category === "all" ? "filters-toggle-button active" : "filters-toggle-button"} onClick={() => setCategory("all")}>Todas ({notes.length})</button>
            {itNoteCategoryOrder.map((value) => (
              <button key={value} type="button" className={category === value ? "filters-toggle-button active" : "filters-toggle-button"} onClick={() => setCategory(value)}>
                {itNoteCategoryLabels[value]} ({categoryCounts.get(value) ?? 0})
              </button>
            ))}
          </div>
        </div>

        {visibleNotes.length === 0 ? (
          <EmptyState
            title={notes.length === 0 ? "Todavía no hay notas" : "Ninguna nota coincide"}
            description={notes.length === 0 ? (canManage ? "Crea la primera con «Nueva nota»: una solución, un procedimiento o un manual en PDF." : "El equipo de informática aún no ha creado notas.") : "Prueba con otras palabras o quita el filtro de tipo."}
          />
        ) : (
          <div className="notes-grid">
            {visibleNotes.map((note) => {
              const preview = noteSearchText(note.content);
              const noteFiles = filesByNote.get(note.id) ?? [];
              return (
                <button key={note.id} type="button" className="note-card" onClick={() => setViewingId(note.id)}>
                  <span className="note-card-top">
                    <span className={`note-category note-category-${note.category}`}>{itNoteCategoryLabels[note.category]}</span>
                    {note.pinned ? <span className="note-pin" title="Fijada">📌</span> : null}
                  </span>
                  <strong>{note.title}</strong>
                  {preview ? <span className="note-card-preview">{preview.slice(0, 180)}</span> : null}
                  <span className="note-card-meta">
                    <span>{authorLabel(note)}</span>
                    {noteFiles.length ? <span>📎 {noteFiles.length}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <Modal open={Boolean(viewingNote)} title={viewingNote?.title ?? ""} eyebrow={viewingNote ? itNoteCategoryLabels[viewingNote.category] : undefined} onClose={() => setViewingId(null)}>
        {viewingNote ? (
          <div className="note-detail">
            <p className="muted">Actualizada el {authorLabel(viewingNote)}</p>
            <NoteBlocksView blocks={viewingNote.content} />
            {(filesByNote.get(viewingNote.id) ?? []).length > 0 ? (
              <div className="note-files">
                <span className="eyebrow">Archivos adjuntos</span>
                <ul>
                  {(filesByNote.get(viewingNote.id) ?? []).map((file) => (
                    <li key={file.id}>
                      <button type="button" className="note-file-link" onClick={() => void handleOpenFile(file)}>📄 {file.fileName}</button>
                      <span className="muted">{formatFileSize(file.sizeBytes)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {canManage ? (
              <div className="modal-actions">
                <button type="button" className="button button-danger" onClick={() => setPendingDelete(viewingNote)}>Eliminar</button>
                <button type="button" className="button button-secondary" onClick={() => void togglePinned(viewingNote)}>{viewingNote.pinned ? "Desfijar" : "Fijar arriba"}</button>
                <button type="button" className="button button-primary" onClick={() => openEditor(viewingNote)}>Editar</button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal open={Boolean(draft)} title={draft?.id ? "Editar nota" : "Nueva nota"} eyebrow="Base de conocimiento" onClose={closeEditor}>
        {draft ? (
          <form
            className="note-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveDraft();
            }}
          >
            <div className="form-grid">
              <label><span>Título</span>
                <input value={draft.title} maxLength={200} placeholder="Ej.: La impresora de almacén no imprime" autoFocus onChange={(event) => updateDraft({ title: event.target.value })} />
              </label>
              <label><span>Tipo</span>
                <select value={draft.category} onChange={(event) => updateDraft({ category: event.target.value as ItNoteCategory })}>
                  {itNoteCategoryOrder.map((value) => <option key={value} value={value}>{itNoteCategoryLabels[value]}</option>)}
                </select>
              </label>
            </div>
            <label className="note-pin-toggle">
              <input type="checkbox" checked={draft.pinned} onChange={(event) => updateDraft({ pinned: event.target.checked })} />
              <span>Fijar arriba del todo</span>
            </label>

            {aiBusy ? (
              <div className="note-ai-status" role="status">
                <span className="note-ai-spinner" aria-hidden="true" />
                <span><strong>Leyendo el manual con IA…</strong> Puede tardar hasta un minuto. Después podrás revisar y cambiar todo antes de guardar.</span>
              </div>
            ) : null}

            <NoteBlocksEditor blocks={draft.content} onChange={(content) => updateDraft({ content })} />

            <div className="note-files">
              <span className="eyebrow">Archivos adjuntos (manuales, capturas…)</span>
              <span className="muted">Con «✨ Rellenar con IA» la IA lee un PDF y escribe la nota: resumen, pasos, tablas y comandos.</span>
              {draft.files.length + draft.stagedFiles.length + draft.pendingFiles.length > 0 ? (
                <ul>
                  {draft.files.map((file) => (
                    <li key={file.id}>
                      <span>📄 {file.fileName}</span>
                      <span className="muted">{formatFileSize(file.sizeBytes)}</span>
                      {isPdfFileName(file.path) ? (
                        <button type="button" className="button button-secondary button-compact" disabled={aiBusy} onClick={() => void fillFromPdf(draft.noteId, { path: file.path, fileName: file.fileName })}>✨ Rellenar con IA</button>
                      ) : null}
                      <button type="button" className="icon-button" aria-label={`Quitar ${file.fileName}`} disabled={aiBusy} onClick={() => updateDraft({ files: draft.files.filter((item) => item.id !== file.id), removedFiles: [...draft.removedFiles, file] })}>×</button>
                    </li>
                  ))}
                  {draft.stagedFiles.map((file) => (
                    <li key={file.path}>
                      <span>📄 {file.fileName}</span>
                      <span className="muted">{formatFileSize(file.sizeBytes)}</span>
                      <button type="button" className="button button-secondary button-compact" disabled={aiBusy} onClick={() => void fillFromPdf(draft.noteId, { path: file.path, fileName: file.fileName })}>✨ Rellenar con IA</button>
                      <button type="button" className="icon-button" aria-label={`Quitar ${file.fileName}`} disabled={aiBusy} onClick={() => removeStagedFile(file)}>×</button>
                    </li>
                  ))}
                  {draft.pendingFiles.map((file, index) => (
                    <li key={`pending-${index}`}>
                      <span>📄 {file.name} <em className="muted">(se subirá al guardar)</em></span>
                      <span className="muted">{formatFileSize(file.size)}</span>
                      {isPdfFileName(file.name) || file.type === "application/pdf" ? (
                        <button type="button" className="button button-secondary button-compact" disabled={aiBusy} onClick={() => void fillFromPdf(draft.noteId, { file })}>✨ Rellenar con IA</button>
                      ) : null}
                      <button type="button" className="icon-button" aria-label={`Quitar ${file.name}`} disabled={aiBusy} onClick={() => updateDraft({ pendingFiles: draft.pendingFiles.filter((_, i) => i !== index) })}>×</button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div
                className={dragging ? "note-dropzone dragging" : "note-dropzone"}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
              >
                <span>Arrastra aquí PDFs, imágenes o documentos (máx. 25 MB cada uno)</span>
                <button type="button" className="button button-secondary button-compact" onClick={() => fileInputRef.current?.click()}>Elegir archivos</button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  hidden
                  onChange={(event) => {
                    addPendingFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={closeEditor} disabled={saving || aiBusy}>Cancelar</button>
              <button type="submit" className="button button-primary" disabled={saving || aiBusy}>{saving ? "Guardando…" : "Guardar nota"}</button>
            </div>
          </form>
        ) : null}
      </Modal>

      <ConfirmationDialog
        open={Boolean(pendingDelete)}
        title="¿Eliminar esta nota?"
        confirmLabel="Eliminar"
        destructive
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      >
        <p>Se eliminará «{pendingDelete?.title}» junto con sus archivos adjuntos. Esta acción no se puede deshacer.</p>
      </ConfirmationDialog>
    </>
  );
}
