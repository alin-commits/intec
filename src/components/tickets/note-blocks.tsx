"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createBlock, noteBlockTypeLabels, noteBlockTypeOrder, type NoteBlock, type NoteBlockType } from "@/lib/tickets/notes";

const URL_PATTERN = /(https?:\/\/[^\s<>"')\]]+)/g;

/** Turns bare http(s) links into clickable anchors; everything else stays plain text. */
function linkify(text: string): ReactNode {
  const parts = text.split(URL_PATTERN);
  return parts.map((part, index) => index % 2 === 1
    ? <a key={index} href={part} target="_blank" rel="noopener noreferrer">{part}</a>
    : <Fragment key={index}>{part}</Fragment>);
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const resetCopied = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resetCopied.current) clearTimeout(resetCopied.current); }, []);
  return (
    <button
      type="button"
      className="note-code-copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          if (resetCopied.current) clearTimeout(resetCopied.current);
          resetCopied.current = setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
}

type ViewSection = { id: string; heading: string | null; blocks: NoteBlock[] };

/** Splits the note at each heading so every section can be shown as its own card. */
function groupSections(blocks: NoteBlock[]): ViewSection[] {
  const sections: ViewSection[] = [];
  for (const block of blocks) {
    if (block.type === "heading") {
      sections.push({ id: block.id, heading: block.text, blocks: [] });
    } else if (sections.length === 0) {
      sections.push({ id: `intro-${block.id}`, heading: null, blocks: [block] });
    } else {
      sections[sections.length - 1].blocks.push(block);
    }
  }
  return sections;
}

const SECTION_ICONS: [RegExp, string][] = [
  [/(error|codigo|troubleshoot|diagnos|solucion de problemas)/, "🔧"],
  [/(problema|incidencia|sintoma|fallo|averia|issue)/, "⚠️"],
  [/(soluci|resuel|arregl|fix)/, "✅"],
  [/(requisit|antes de|necesit|preparaci|comprobaci|checklist)/, "📋"],
  [/(instala|montaje|conexi|conectar|configura|puesta en marcha|setup)/, "🛠️"],
  [/(uso|utiliza|funcionamiento|como se usa|operaci)/, "🖱️"],
  [/(mantenimiento|limpieza|actualiza)/, "🧰"],
  [/(especificaci|datos|caracter|referencia|tabla|indicador|luces|led)/, "📊"],
  [/(seguridad|aviso|precauci|advertencia|importante)/, "🛡️"],
  [/(contacto|soporte|proveedor|garant)/, "☎️"],
  [/(resumen|para que sirve|introduc|descripci|que es)/, "💡"],
];

function sectionIcon(heading: string): string {
  const normalized = heading.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return SECTION_ICONS.find(([pattern]) => pattern.test(normalized))?.[1] ?? "📌";
}

function ProgressBar({ done, total, onReset }: { done: number; total: number; onReset: () => void }) {
  const percent = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="note-progress">
      <div className="note-progress-track" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>
      <span className="note-progress-label">{done === total ? "¡Completado!" : `${done} de ${total}`}</span>
      {done > 0 ? <button type="button" className="note-progress-reset" onClick={() => onReset()}>Reiniciar</button> : null}
    </div>
  );
}

/**
 * Read view of a note. Steps and checklist items can be ticked while following
 * the guide; that progress only lasts while the note is open (it is never saved).
 */
export function NoteBlocksView({ blocks }: { blocks: NoteBlock[] }) {
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(
    blocks.flatMap((block) => (block.type === "checklist" ? block.items.flatMap((item, index) => (item.done ? [`${block.id}:${index}`] : [])) : [])),
  ));
  const sections = useMemo(() => groupSections(blocks), [blocks]);
  const headed = sections.filter((section) => section.heading);

  if (blocks.length === 0) return <p className="muted">Esta nota todavía no tiene contenido.</p>;

  function toggle(key: string) {
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function reset(blockId: string) {
    setTicked((current) => new Set(Array.from(current).filter((key) => !key.startsWith(`${blockId}:`))));
  }

  function renderBlock(block: NoteBlock, isSummary: boolean) {
    switch (block.type) {
      case "heading":
        return null;
      case "text":
        return isSummary
          ? <div key={block.id} className="note-summary"><span className="note-summary-icon" aria-hidden="true">💡</span><p>{linkify(block.text)}</p></div>
          : <p key={block.id} className="note-view-text">{linkify(block.text)}</p>;
      case "code":
        return (
          <div key={block.id} className="note-code">
            <span className="note-code-label">Comando</span>
            <CopyButton text={block.text} />
            <pre><code>{block.text}</code></pre>
          </div>
        );
      case "steps": {
        const doneCount = block.items.filter((_, index) => ticked.has(`${block.id}:${index}`)).length;
        const nextIndex = doneCount > 0 ? block.items.findIndex((_, index) => !ticked.has(`${block.id}:${index}`)) : -1;
        return (
          <div key={block.id} className="note-steps-block">
            {block.items.length > 1 ? <ProgressBar done={doneCount} total={block.items.length} onReset={() => reset(block.id)} /> : null}
            <ol className="note-stepper">
              {block.items.map((item, index) => {
                const key = `${block.id}:${index}`;
                const isDone = ticked.has(key);
                const className = isDone ? "done" : index === nextIndex ? "next" : undefined;
                return (
                  <li key={index} className={className}>
                    <button type="button" className="note-step-number" aria-pressed={isDone} aria-label={isDone ? `Desmarcar paso ${index + 1}` : `Marcar paso ${index + 1} como hecho`} onClick={() => toggle(key)}>
                      {isDone ? "✓" : index + 1}
                    </button>
                    <div className="note-step-body">
                      <span className="note-step-kicker">Paso {index + 1}{index === nextIndex ? " · siguiente" : ""}</span>
                      <p>{linkify(item)}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      }
      case "checklist": {
        const doneCount = block.items.filter((_, index) => ticked.has(`${block.id}:${index}`)).length;
        return (
          <div key={block.id} className="note-steps-block">
            {block.items.length > 1 ? <ProgressBar done={doneCount} total={block.items.length} onReset={() => reset(block.id)} /> : null}
            <ul className="note-view-checklist">
              {block.items.map((item, index) => {
                const key = `${block.id}:${index}`;
                const isDone = ticked.has(key);
                return (
                  <li key={index} className={isDone ? "done" : undefined}>
                    <button type="button" className="note-check-row" aria-pressed={isDone} onClick={() => toggle(key)}>
                      <span className="note-check" aria-hidden="true">{isDone ? "✓" : ""}</span>
                      <span>{linkify(item.text)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      }
      case "table": {
        if (block.rows.length === 0) return null;
        const [header, ...body] = block.rows;
        return (
          <div key={block.id} className="note-table-scroll">
            <table className="note-table note-table-view">
              <thead><tr>{header.map((cell, index) => <th key={index}>{cell}</th>)}</tr></thead>
              <tbody>{body.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, index) => <td key={index}>{linkify(cell)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        );
      }
    }
  }

  return (
    <div className="note-view">
      {headed.length >= 3 ? (
        <nav className="note-toc" aria-label="Secciones de la nota">
          <span className="note-toc-title">En esta nota</span>
          <div className="note-toc-links">
            {headed.map((section) => (
              <button
                key={section.id}
                type="button"
                className="note-toc-link"
                onClick={() => document.getElementById(`note-section-${section.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                <span aria-hidden="true">{sectionIcon(section.heading ?? "")}</span> {section.heading}
              </button>
            ))}
          </div>
        </nav>
      ) : null}

      {sections.map((section, sectionIndex) => (
        section.heading === null ? (
          <div key={section.id} className="note-intro">
            {section.blocks.map((block, index) => renderBlock(block, sectionIndex === 0 && index === 0 && block.type === "text"))}
          </div>
        ) : (
          <section key={section.id} id={`note-section-${section.id}`} className="note-section">
            <h3 className="note-section-heading">
              <span className="note-section-icon" aria-hidden="true">{sectionIcon(section.heading)}</span>
              {section.heading}
            </h3>
            {section.blocks.length > 0 ? <div className="note-section-body">{section.blocks.map((block) => renderBlock(block, false))}</div> : null}
          </section>
        )
      ))}
    </div>
  );
}

/** Enter in a single-line field would submit the whole note form. */
function blockEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === "Enter") event.preventDefault();
}

function autoRows(text: string, min = 3): number {
  return Math.min(20, Math.max(min, text.split("\n").length + 1));
}

function BlockFields({ block, onChange }: { block: NoteBlock; onChange: (next: NoteBlock) => void }) {
  switch (block.type) {
    case "heading":
      return <input className="note-input note-input-heading" value={block.text} placeholder="Título de sección" maxLength={200} onKeyDown={blockEnter} onChange={(event) => onChange({ ...block, text: event.target.value })} />;
    case "text":
      return <textarea className="note-input" value={block.text} rows={autoRows(block.text)} placeholder="Escribe aquí… Los enlaces (https://…) se podrán pulsar." onChange={(event) => onChange({ ...block, text: event.target.value })} />;
    case "code":
      return <textarea className="note-input note-input-code" value={block.text} rows={autoRows(block.text, 2)} spellCheck={false} placeholder="ipconfig /flushdns" onChange={(event) => onChange({ ...block, text: event.target.value })} />;
    case "steps":
      return (
        <div className="note-list-editor">
          {block.items.map((item, index) => (
            <div key={index} className="note-list-row">
              <span className="note-list-marker">{index + 1}.</span>
              <input
                className="note-input"
                value={item}
                placeholder="Describe el paso"
                onChange={(event) => onChange({ ...block, items: block.items.map((value, i) => (i === index ? event.target.value : value)) })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onChange({ ...block, items: [...block.items.slice(0, index + 1), "", ...block.items.slice(index + 1)] });
                  }
                }}
              />
              <button type="button" className="icon-button" aria-label="Quitar paso" onClick={() => onChange({ ...block, items: block.items.filter((_, i) => i !== index) })}>×</button>
            </div>
          ))}
          <button type="button" className="note-add-row" onClick={() => onChange({ ...block, items: [...block.items, ""] })}>+ Añadir paso</button>
        </div>
      );
    case "checklist":
      return (
        <div className="note-list-editor">
          {block.items.map((item, index) => (
            <div key={index} className="note-list-row">
              <input
                type="checkbox"
                checked={item.done}
                aria-label="Marcado"
                onChange={(event) => onChange({ ...block, items: block.items.map((value, i) => (i === index ? { ...value, done: event.target.checked } : value)) })}
              />
              <input
                className="note-input"
                value={item.text}
                placeholder="Elemento a comprobar"
                onChange={(event) => onChange({ ...block, items: block.items.map((value, i) => (i === index ? { ...value, text: event.target.value } : value)) })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onChange({ ...block, items: [...block.items.slice(0, index + 1), { text: "", done: false }, ...block.items.slice(index + 1)] });
                  }
                }}
              />
              <button type="button" className="icon-button" aria-label="Quitar elemento" onClick={() => onChange({ ...block, items: block.items.filter((_, i) => i !== index) })}>×</button>
            </div>
          ))}
          <button type="button" className="note-add-row" onClick={() => onChange({ ...block, items: [...block.items, { text: "", done: false }] })}>+ Añadir elemento</button>
        </div>
      );
    case "table": {
      const columns = block.rows[0]?.length ?? 1;
      const setCell = (rowIndex: number, colIndex: number, value: string) =>
        onChange({ ...block, rows: block.rows.map((row, r) => (r === rowIndex ? row.map((cell, c) => (c === colIndex ? value : cell)) : row)) });
      return (
        <div className="note-table-editor">
          <div className="note-table-scroll">
            <table className="note-table">
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, colIndex) => (
                      <td key={colIndex}>
                        <input
                          className={rowIndex === 0 ? "note-cell note-cell-header" : "note-cell"}
                          value={cell}
                          placeholder={rowIndex === 0 ? `Columna ${colIndex + 1}` : ""}
                          onKeyDown={blockEnter}
                          onChange={(event) => setCell(rowIndex, colIndex, event.target.value)}
                        />
                      </td>
                    ))}
                    <td className="note-table-row-action">
                      {block.rows.length > 1 ? (
                        <button type="button" className="icon-button" aria-label="Quitar fila" onClick={() => onChange({ ...block, rows: block.rows.filter((_, r) => r !== rowIndex) })}>×</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="note-table-actions">
            <button type="button" className="note-add-row" onClick={() => onChange({ ...block, rows: [...block.rows, Array(columns).fill("")] })}>+ Fila</button>
            <button type="button" className="note-add-row" onClick={() => onChange({ ...block, rows: block.rows.map((row) => [...row, ""]) })}>+ Columna</button>
            {columns > 1 ? (
              <button type="button" className="note-add-row" onClick={() => onChange({ ...block, rows: block.rows.map((row) => row.slice(0, -1)) })}>− Última columna</button>
            ) : null}
            <span className="muted">La primera fila es la cabecera.</span>
          </div>
        </div>
      );
    }
  }
}

function AddBlockMenu({ onAdd }: { onAdd: (type: NoteBlockType) => void }) {
  return (
    <div className="note-add-block">
      <span className="muted">Añadir:</span>
      {noteBlockTypeOrder.map((type) => (
        <button key={type} type="button" className="button button-secondary button-compact" onClick={() => onAdd(type)}>{noteBlockTypeLabels[type]}</button>
      ))}
    </div>
  );
}

export function NoteBlocksEditor({ blocks, onChange }: { blocks: NoteBlock[]; onChange: (next: NoteBlock[]) => void }) {
  function update(index: number, next: NoteBlock) {
    onChange(blocks.map((block, i) => (i === index ? next : block)));
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="note-editor">
      {blocks.map((block, index) => (
        <div key={block.id} className="note-editor-block">
          <div className="note-editor-block-bar">
            <span className="eyebrow">{noteBlockTypeLabels[block.type]}</span>
            <div className="note-editor-block-actions">
              <button type="button" className="icon-button" aria-label="Subir bloque" disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
              <button type="button" className="icon-button" aria-label="Bajar bloque" disabled={index === blocks.length - 1} onClick={() => move(index, 1)}>↓</button>
              <button type="button" className="icon-button" aria-label="Eliminar bloque" onClick={() => onChange(blocks.filter((_, i) => i !== index))}>×</button>
            </div>
          </div>
          <BlockFields block={block} onChange={(next) => update(index, next)} />
        </div>
      ))}
      <AddBlockMenu onAdd={(type) => onChange([...blocks, createBlock(type)])} />
    </div>
  );
}
