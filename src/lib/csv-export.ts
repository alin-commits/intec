export type CsvColumn<T> = { header: string; value: (row: T) => string | number | null | undefined };

function escapeCsvValue(raw: string): string {
  if (/[";\n]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

function downloadCsvText(filename: string, csv: string) {
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

function tableCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((column) => escapeCsvValue(column.header)).join(";");
  const lines = rows.map((row) => columns.map((column) => {
    const raw = column.value(row);
    return escapeCsvValue(raw === null || raw === undefined ? "" : String(raw));
  }).join(";"));
  return [header, ...lines].join("\r\n");
}

export function downloadCsv<T>(filename: string, rows: T[], columns: CsvColumn<T>[]) {
  downloadCsvText(filename, tableCsv(rows, columns));
}

export type CsvSummaryItem = { label: string; value: string | number };

export function downloadCsvReport<T>(
  filename: string,
  summary: CsvSummaryItem[],
  rows: T[],
  columns: CsvColumn<T>[],
) {
  const summaryLines = summary.map((item) => `${escapeCsvValue(item.label)};${escapeCsvValue(String(item.value))}`);
  const csv = [...summaryLines, "", tableCsv(rows, columns)].join("\r\n");
  downloadCsvText(filename, csv);
}
