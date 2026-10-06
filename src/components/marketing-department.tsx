"use client";

import { CampaignsManager } from "@/components/campaigns-manager";
import { ExpensesManager } from "@/components/expenses-manager";
import { PostPlanner } from "@/components/rrss/post-planner";
import { RrssManager } from "@/components/rrss-manager";
import { DepartmentTabs, type DepartmentPage } from "@/components/ui/department-tabs";
import { CAMPAIGNS_ROLES, EXPENSES_ROLES, RRSS_ROLES } from "@/lib/constants";

/*
  Marketing: campañas, redes sociales, Meta Ads, mailing y sus gastos en un
  solo sitio. Antes eran tres entradas del menú (Campañas, RRSS y Gastos), pero
  es el mismo departamento. Comercial ve las campañas, pero no las métricas de
  redes ni los gastos.
*/

const pages: DepartmentPage[] = [
  { key: "campanas", label: "Campañas", roles: CAMPAIGNS_ROLES, render: () => <CampaignsManager /> },
  { key: "redes", label: "Redes sociales", roles: RRSS_ROLES, render: () => <RrssManager tab="social" /> },
  { key: "ads", label: "Meta Ads", roles: RRSS_ROLES, render: () => <RrssManager tab="ads" /> },
  { key: "mailing", label: "Mailing", roles: RRSS_ROLES, render: () => <RrssManager tab="mailing" /> },
  { key: "gastos", label: "Gastos", roles: EXPENSES_ROLES, render: () => <ExpensesManager /> },
  { key: "feed", label: "Organizador de posts", roles: RRSS_ROLES, render: () => <PostPlanner /> },
];

export function MarketingDepartment({ initial }: { initial: string | null }) {
  return <DepartmentTabs pages={pages} initial={initial} label="Páginas de Marketing" />;
}
