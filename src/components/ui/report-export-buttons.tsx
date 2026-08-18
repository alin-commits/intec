"use client";

type ReportExportButtonsProps = {
  onExportCsv: () => void;
  onExportPdf: () => void;
  pdfBusy: boolean;
};

export function ReportExportButtons({ onExportCsv, onExportPdf, pdfBusy }: ReportExportButtonsProps) {
  return (
    <div className="panel-heading-trailing">
      <button type="button" className="button button-compact button-secondary" onClick={onExportCsv}>Exportar CSV</button>
      <button type="button" className="button button-compact button-secondary" onClick={onExportPdf} disabled={pdfBusy}>{pdfBusy ? "Generando PDF…" : "Exportar PDF"}</button>
    </div>
  );
}
