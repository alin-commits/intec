"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { hasAnyRole } from "@/lib/constants";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { loadCurrentProfile } from "@/lib/supabase/current-profile";
import { DEPARTMENTS, departmentLabels, getDirectionViewAs, setDirectionViewAs, type DirectionDepartment } from "@/lib/direction-view";
import type { AppRole } from "@/lib/types";
import { DashboardClient } from "./dashboard-client";
import { TicketsDashboardView } from "./tickets-dashboard-view";
import { MarketingDashboardView } from "./marketing-dashboard-view";

export function DashboardRouter() {
  const configured = isSupabaseConfigured();
  const router = useRouter();
  const [roles, setRoles] = useState<AppRole[] | null>(configured ? null : ["admin"]);
  const [directionView, setDirectionViewState] = useState<DirectionDepartment | null>(null);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    void (async () => {
      try {
        // Se reaprovecha la consulta que ya hacen el menú y las pestañas.
        const profile = await loadCurrentProfile();
        if (!active) return;
        // Sin sesión no se decide nada aquí: de eso se encarga el proxy, que
        // manda a iniciar sesión. Suponer "admin" enseñaba de más.
        if (!profile) return;
        setRoles(profile.roles);
        if (profile.roles.includes("direction")) setDirectionViewState(getDirectionViewAs());
      } catch (cause) {
        console.error("No se pudo saber qué rol tiene esta persona:", cause);
        if (active) setRoles([]);
      }
    })();
    return () => { active = false; };
  }, [configured]);

  // El rol de empleado solo llega a Contraseñas. La redirección va en un efecto:
  // navegar desde el cuerpo del render se repite en cada pasada.
  const onlyEmployee = roles !== null && roles.length > 0 && roles.every((role) => role === "employee");
  // Administración no tiene panel de inicio: su página es Pagos.
  const onlyPayments = roles !== null && roles.includes("accounting") && roles.every((role) => role === "accounting" || role === "employee");
  useEffect(() => {
    if (onlyEmployee) router.replace("/contrasenas");
    else if (onlyPayments) router.replace("/pagos");
  }, [onlyEmployee, onlyPayments, router]);

  if (roles === null || onlyEmployee || onlyPayments) return <div className="page-stack" />;

  /*
   * Dirección tiene tres paneles de inicio, uno por departamento, y se cambia de
   * uno a otro aquí mismo. Antes había que elegir departamento antes de ver
   * nada, y esa elección además escondía media aplicación del menú. Se recuerda
   * el último elegido; la primera vez se entra por el comercial, que es el que
   * trae las ventas.
   */
  if (roles.includes("direction")) {
    const vista = directionView ?? "commercial";
    return (
      <div className="page-stack">
        <div className="view-tabs" role="tablist" aria-label="Panel de inicio">
          {DEPARTMENTS.map((department) => (
            <button
              key={department}
              type="button"
              role="tab"
              aria-selected={vista === department}
              className={vista === department ? "view-tab active" : "view-tab"}
              onClick={() => {
                setDirectionViewAs(department);
                setDirectionViewState(department);
              }}
            >
              {departmentLabels[department]}
            </button>
          ))}
        </div>
        {vista === "it" ? <TicketsDashboardView /> : vista === "marketing" ? <MarketingDashboardView /> : <DashboardClient />}
      </div>
    );
  }

  // Admin/commercial/viewer own the general dashboard — anyone holding one
  // of those roles (alone or combined with marketing/it) lands there.
  if (hasAnyRole(roles, ["admin", "commercial", "viewer"])) return <DashboardClient />;
  if (roles.includes("marketing")) return <MarketingDashboardView />;
  if (roles.includes("it")) return <TicketsDashboardView />;
  return <DashboardClient />;
}
