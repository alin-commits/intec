"use client";

import { AdminTodayView } from "@/components/admin/admin-today-view";
import { PaymentsView } from "@/components/payments/payments-view";
import { DepartmentTabs, type DepartmentPage } from "@/components/ui/department-tabs";

/*
  Administración: lo del día (cobros, pagos, albaranes sin facturar y bancos)
  y los pagos a proveedores por confirming, en un solo sitio. Antes eran dos
  entradas del menú, pero es el mismo departamento.
*/

const pages: DepartmentPage[] = [
  { key: "hoy", label: "Hoy", render: () => <AdminTodayView /> },
  { key: "remesas", label: "Remesas de confirming", render: (go) => <PaymentsView tab="remesas" onTab={go} /> },
  { key: "tesoreria", label: "Tesorería", render: (go) => <PaymentsView tab="tesoreria" onTab={go} /> },
  { key: "bancos", label: "Contratos de bancos", render: (go) => <PaymentsView tab="bancos" onTab={go} /> },
];

export function AdministrationDepartment({ initial }: { initial: string | null }) {
  return <DepartmentTabs pages={pages} initial={initial} label="Páginas de Administración" />;
}
