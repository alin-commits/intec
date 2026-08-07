"use client";

import { useEffect, useState } from "react";
import { hasAnyRole } from "@/lib/constants";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { getDirectionViewAs, setDirectionViewAs, type DirectionDepartment } from "@/lib/direction-view";
import type { AppRole } from "@/lib/types";
import { DashboardClient } from "./dashboard-client";
import { TicketsDashboardView } from "./tickets-dashboard-view";
import { MarketingDashboardView } from "./marketing-dashboard-view";
import { DirectionDepartmentPicker } from "./direction-department-picker";

export function DashboardRouter() {
  const configured = isSupabaseConfigured();
  const [roles, setRoles] = useState<AppRole[] | null>(configured ? null : ["admin"]);
  const [directionView, setDirectionViewState] = useState<DirectionDepartment | null>(null);

  useEffect(() => {
    if (!configured) return;
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: authData }) => {
      if (!authData.user) {
        setRoles(["admin"]);
        return;
      }
      const { data } = await supabase.from("profiles").select("roles").eq("id", authData.user.id).maybeSingle();
      const resolvedRoles = (data?.roles as AppRole[] | undefined) ?? ["admin"];
      setRoles(resolvedRoles);
      if (resolvedRoles.includes("direction")) setDirectionViewState(getDirectionViewAs());
    });
  }, [configured]);

  if (roles === null) return <div className="page-stack" />;

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
