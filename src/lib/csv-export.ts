export type CsvColumn<T> = { header: string; value: (row: T) => string | number | null | undefined };

function escapeCsvValue(raw: string): string {
  if (/[";\n]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

export function downloadCsv<T>(filename: string, rows: T[], columns: CsvColumn<T>[]) {
  const header = columns.map((column) => escapeCsvValue(column.header)).join(";");
  const lines = rows.map((row) => columns.map((column) => {
    const raw = column.value(row);
    return escapeCsvValue(raw === null || raw === undefined ? "" : String(raw));
  }).join(";"));
  const csv = [header, ...lines].join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
