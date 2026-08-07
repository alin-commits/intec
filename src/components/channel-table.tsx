import type { ReactNode } from "react";
import { inquiryChannelLabels, inquiryChannelOrder } from "@/lib/constants";
import { numberFormatter } from "@/lib/format";
import type { InquiryType } from "@/lib/types";

export type ChannelTableColumn = InquiryType | "total" | "label" | "trailing";

export type ChannelTableRow = {
  key: string;
  label: ReactNode;
  counts: Partial<Record<InquiryType, number>>;
  total: number;
  trailing?: ReactNode;
};

type ChannelTableProps = {
  rowHeaderLabel: string;
  rows: ChannelTableRow[];
  footerRow?: ChannelTableRow;
  trailingHeader?: string;
  sort?: {
    activeColumn: ChannelTableColumn;
    direction: "asc" | "desc";
    onSort: (column: ChannelTableColumn) => void;
  };
};

export function ChannelTable({ rowHeaderLabel, rows, footerRow, trailingHeader, sort }: ChannelTableProps) {
  function headerCell(column: ChannelTableColumn, label: string) {
    if (!sort) return <th key={column}>{label}</th>;
    const arrow = sort.activeColumn === column ? (sort.direction === "asc" ? " ↑" : " ↓") : "";
    return (
      <th key={column}>
        <button type="button" className="sort-button" onClick={() => sort.onSort(column)}>{label}{arrow}</button>
      </th>
    );
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {headerCell("label", rowHeaderLabel)}
            {inquiryChannelOrder.map((channel) => headerCell(channel, inquiryChannelLabels[channel]))}
            {headerCell("total", "Total")}
            {trailingHeader ? headerCell("trailing", trailingHeader) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              {inquiryChannelOrder.map((channel) => <td key={channel}>{numberFormatter.format(row.counts[channel] ?? 0)}</td>)}
              <td><strong>{numberFormatter.format(row.total)}</strong></td>
              {trailingHeader ? <td>{row.trailing}</td> : null}
            </tr>
          ))}
        </tbody>
        {footerRow ? (
          <tfoot>
            <tr className="channel-table-footer-row">
              <td><strong>{footerRow.label}</strong></td>
              {inquiryChannelOrder.map((channel) => <td key={channel}><strong>{numberFormatter.format(footerRow.counts[channel] ?? 0)}</strong></td>)}
              <td><strong>{numberFormatter.format(footerRow.total)}</strong></td>
              {trailingHeader ? <td>{footerRow.trailing}</td> : null}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
