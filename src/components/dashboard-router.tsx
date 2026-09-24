"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { hasAnyRole } from "@/lib/constants";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { loadCurrentProfile } from "@/lib/supabase/current-profile";
import { getDirectionViewAs, setDirectionViewAs, type DirectionDepartment } from "@/lib/direction-view";
import type { AppRole } from "@/lib/types";
import { DashboardClient } from "./dashboard-client";
import { TicketsDashboardView } from "./tickets-dashboard-view";
import { MarketingDashboardView } from "./marketing-dashboard-view";
import { DirectionDepartmentPicker } from "./direction-department-picker";

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
  useEffect(() => {
    if (onlyEmployee) router.replace("/contrasenas");
  }, [onlyEmployee, router]);

  if (roles === null || onlyEmployee) return <div className="page-stack" />;

  if (roles.includes("direction")) {
    if (!directionView) {
      return (
        <DirectionDepartmentPicker
          onChoose={(department) => {
            setDirectionViewAs(department);
            setDirectionViewState(department);
            window.dispatchEvent(new Event("intec-direction-view-change"));
          }}
        />
      );
    }
    if (directionView === "it") return <TicketsDashboardView />;
    if (directionView === "marketing") return <MarketingDashboardView />;
    return <DashboardClient />;
  }

  // Admin/commercial/viewer own the general dashboard — anyone holding one
  // of those roles (alone or combined with marketing/it) lands there.
  if (hasAnyRole(roles, ["admin", "commercial", "viewer"])) return <DashboardClient />;
  if (roles.includes("marketing")) return <MarketingDashboardView />;
  if (roles.includes("it")) return <TicketsDashboardView />;
  return <DashboardClient />;
}
