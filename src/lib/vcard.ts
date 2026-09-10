import type { BusinessCard } from "@/lib/types";

function escapeVCardValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export function buildVCard(card: BusinessCard, unitName: string): string {
  const lines = ["BEGIN:VCARD", "VERSION:3.0"];
  lines.push(`N:${escapeVCardValue(card.fullName)};;;;`);
  lines.push(`FN:${escapeVCardValue(card.fullName)}`);
  lines.push(`TITLE:${escapeVCardValue(card.position)}`);
  lines.push(`ORG:${escapeVCardValue(unitName)}`);
  if (card.phone) lines.push(`TEL;TYPE=CELL:${escapeVCardValue(card.phone)}`);
  if (card.email) lines.push(`EMAIL:${escapeVCardValue(card.email)}`);
  if (card.website) lines.push(`URL:${escapeVCardValue(card.website)}`);
  if (card.companyAddress) lines.push(`ADR;TYPE=WORK:;;${escapeVCardValue(card.companyAddress)};;;;`);
  lines.push("END:VCARD");
  return lines.join("\r\n");
}

export function downloadVCard(filename: string, vcard: string) {
  const blob = new Blob([vcard], { type: "text/vcard;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
