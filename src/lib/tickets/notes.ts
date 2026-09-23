// IT knowledge base (Tickets → Notas). A note's body is a list of blocks so it
// can mix free text, numbered steps, checklists, tables and commands.

export const IT_NOTES_BUCKET = "it-notes";
export const IT_NOTE_FILE_MAX_BYTES = 25 * 1024 * 1024;

export type ItNoteCategory = "solution" | "manual" | "procedure" | "reference" | "other";

export const itNoteCategoryOrder: ItNoteCategory[] = ["solution", "manual", "procedure", "reference", "other"];

export const itNoteCategoryLabels: Record<ItNoteCategory, string> = {
  solution: "Solución a problema",
  manual: "Manual",
  procedure: "Procedimiento",
  reference: "Referencia",
  other: "Otros",
};

export type NoteBlock =
  | { id: string; type: "heading"; text: string }
  | { id: string; type: "text"; text: string }
  | { id: string; type: "steps"; items: string[] }
  | { id: string; type: "checklist"; items: { text: string; done: boolean }[] }
  | { id: string; type: "table"; rows: string[][] }
  | { id: string; type: "code"; text: string };

export type NoteBlockType = NoteBlock["type"];

export const noteBlockTypeLabels: Record<NoteBlockType, string> = {
  heading: "Título",
  text: "Texto",
  steps: "Pasos",
  checklist: "Checklist",
  table: "Tabla",
  code: "Comando / código",
};

export const noteBlockTypeOrder: NoteBlockType[] = ["text", "heading", "steps", "checklist", "table", "code"];

export type ItNoteFile = {
  id: string;
  noteId: string;
  path: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
};

export type ItNote = {
  id: string;
  title: string;
  category: ItNoteCategory;
  content: NoteBlock[];
  pinned: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

function newBlockId(): string {
  return crypto.randomUUID();
}

export function createBlock(type: NoteBlockType): NoteBlock {
  const id = newBlockId();
  switch (type) {
    case "heading": return { id, type, text: "" };
    case "text": return { id, type, text: "" };
    case "code": return { id, type, text: "" };
    case "steps": return { id, type, items: [""] };
    case "checklist": return { id, type, items: [{ text: "", done: false }] };
    case "table": return { id, type, rows: [["", "", ""], ["", "", ""], ["", "", ""]] };
  }
}

const asString = (value: unknown) => (typeof value === "string" ? value : "");

/** Content comes from a jsonb column; anything malformed is dropped instead of breaking the page. */
export function parseNoteContent(raw: unknown): NoteBlock[] {
  if (!Array.isArray(raw)) return [];
  const blocks: NoteBlock[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = asString(record.id) || newBlockId();
    switch (record.type) {
      case "heading":
      case "text":
      case "code":
        blocks.push({ id, type: record.type as "heading" | "text" | "code", text: asString(record.text) });
        break;
      case "steps":
        blocks.push({ id, type: "steps", items: Array.isArray(record.items) ? record.items.map(asString) : [] });
        break;
      case "checklist":
        blocks.push({
          id,
          type: "checklist",
          items: Array.isArray(record.items)
            ? record.items.map((entry) => {
              const value = (entry ?? {}) as Record<string, unknown>;
              return { text: asString(value.text), done: Boolean(value.done) };
            })
            : [],
        });
        break;
      case "table": {
        const rows = Array.isArray(record.rows) ? record.rows.map((row) => (Array.isArray(row) ? row.map(asString) : [])) : [];
        const width = Math.max(1, ...rows.map((row) => row.length));
        blocks.push({ id, type: "table", rows: rows.map((row) => [...row, ...Array(width - row.length).fill("")]) });
        break;
      }
    }
  }
  return blocks;
}

/** Drops empty lines/rows before saving so half-filled blocks don't clutter the note. */
export function cleanNoteContent(blocks: NoteBlock[]): NoteBlock[] {
  const cleaned: NoteBlock[] = [];
  for (const block of blocks) {
    if (block.type === "steps") {
      const items = block.items.map((item) => item.trim()).filter(Boolean);
      if (items.length) cleaned.push({ ...block, items });
    } else if (block.type === "checklist") {
      const items = block.items.map((item) => ({ ...item, text: item.text.trim() })).filter((item) => item.text);
      if (items.length) cleaned.push({ ...block, items });
    } else if (block.type === "table") {
      const rows = block.rows.filter((row) => row.some((cell) => cell.trim()));
      if (rows.length) cleaned.push({ ...block, rows });
    } else if (block.text.trim()) {
      cleaned.push({ ...block, text: block.type === "code" ? block.text.replace(/\s+$/, "") : block.text.trim() });
    }
  }
  return cleaned;
}

/** Plain text of a note, used for searching and for the preview on each card. */
export function noteSearchText(blocks: NoteBlock[]): string {
  return blocks.map((block) => {
    if (block.type === "steps") return block.items.join(" ");
    if (block.type === "checklist") return block.items.map((item) => item.text).join(" ");
    if (block.type === "table") return block.rows.map((row) => row.join(" ")).join(" ");
    return block.text;
  }).join(" ").replace(/\s+/g, " ").trim();
}

export function mapItNoteRow(row: Record<string, unknown>): ItNote {
  return {
    id: String(row.id),
    title: String(row.title),
    category: row.category as ItNoteCategory,
    content: parseNoteContent(row.content),
    pinned: Boolean(row.pinned),
    createdBy: row.created_by ? String(row.created_by) : null,
    updatedBy: row.updated_by ? String(row.updated_by) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapItNoteFileRow(row: Record<string, unknown>): ItNoteFile {
  return {
    id: String(row.id),
    noteId: String(row.note_id),
    path: String(row.path),
    fileName: String(row.file_name),
    sizeBytes: Number(row.size_bytes ?? 0),
    createdAt: String(row.created_at),
  };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** Storage keys only allow a safe subset of characters; the original name is kept in the table. */
export function noteFileStoragePath(noteId: string, fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const extension = dot > 0 ? fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) : "";
  return `${noteId}/${crypto.randomUUID()}${extension ? `.${extension}` : ""}`;
}
