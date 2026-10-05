"use client";

import { AdminTodayView } from "@/components/admin/admin-today-view";
import { ScheduleManager } from "@/components/horarios/schedule-manager";
import { PaymentsView } from "@/components/payments/payments-view";
import { DepartmentTabs, type DepartmentPage } from "@/components/ui/department-tabs";
import { SCHEDULE_ROLES } from "@/lib/constants";

/*
  Administración: lo del día (cobros, pagos, albaranes sin facturar y bancos),
  los pagos a proveedores por confirming y el cuadrante de horarios de la
  plantilla, en un solo sitio. Antes eran entradas sueltas del menú, pero es el
  mismo departamento.
*/

const pages: DepartmentPage[] = [
  { key: "hoy", label: "Hoy", render: () => <AdminTodayView /> },
  { key: "remesas", label: "Remesas de confirming", render: (go) => <PaymentsView tab="remesas" onTab={go} /> },
  { key: "tesoreria", label: "Tesorería", render: (go) => <PaymentsView tab="tesoreria" onTab={go} /> },
  { key: "bancos", label: "Contratos de bancos", render: (go) => <PaymentsView tab="bancos" onTab={go} /> },
  { key: "horarios", label: "Horarios", roles: SCHEDULE_ROLES, render: () => <ScheduleManager /> },
];

export function AdministrationDepartment({ initial }: { initial: string | null }) {
  return <DepartmentTabs pages={pages} initial={initial} label="Páginas de Administración" />;
}
