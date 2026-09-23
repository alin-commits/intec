"use client";

import { Fragment, useState, type KeyboardEvent, type ReactNode } from "react";
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
  return (
    <button
      type="button"
      className="note-code-copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
}

export function NoteBlocksView({ blocks }: { blocks: NoteBlock[] }) {
  if (blocks.length === 0) return <p className="muted">Esta nota todavía no tiene contenido.</p>;
  return (
    <div className="note-view">
      {blocks.map((block) => {
        switch (block.type) {
          case "heading":
            return <h3 key={block.id} className="note-view-heading">{block.text}</h3>;
          case "text":
            return <p key={block.id} className="note-view-text">{linkify(block.text)}</p>;
          case "code":
            return (
              <div key={block.id} className="note-code">
                <CopyButton text={block.text} />
                <pre><code>{block.text}</code></pre>
              </div>
            );
          case "steps":
            return <ol key={block.id} className="note-view-steps">{block.items.map((item, index) => <li key={index}>{linkify(item)}</li>)}</ol>;
          case "checklist":
            return (
              <ul key={block.id} className="note-view-checklist">
                {block.items.map((item, index) => (
                  <li key={index} className={item.done ? "done" : undefined}>
                    <span className="note-check" aria-hidden="true">{item.done ? "✓" : ""}</span>
                    <span>{linkify(item.text)}</span>
                  </li>
                ))}
              </ul>
            );
          case "table": {
            if (block.rows.length === 0) return null;
            const [header, ...body] = block.rows;
            return (
              <div key={block.id} className="note-table-scroll">
                <table className="note-table">
                  <thead><tr>{header.map((cell, index) => <th key={index}>{cell}</th>)}</tr></thead>
                  <tbody>{body.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, index) => <td key={index}>{linkify(cell)}</td>)}</tr>)}</tbody>
                </table>
              </div>
            );
          }
        }
      })}
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
