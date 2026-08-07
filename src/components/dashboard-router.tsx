"use client";

import { useEffect, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { getDirectionViewAs, setDirectionViewAs, type DirectionDepartment } from "@/lib/direction-view";
import type { AppRole } from "@/lib/types";
import { DashboardClient } from "./dashboard-client";
import { TicketsDashboardView } from "./tickets-dashboard-view";
import { MarketingDashboardView } from "./marketing-dashboard-view";
import { DirectionDepartmentPicker } from "./direction-department-picker";

export function DashboardRouter() {
  const configured = isSupabaseConfigured();
  const [role, setRole] = useState<AppRole | null>(configured ? null : "admin");
  const [directionView, setDirectionViewState] = useState<DirectionDepartment | null>(null);

  useEffect(() => {
    if (!configured) return;
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: authData }) => {
      if (!authData.user) {
        setRole("admin");
        return;
      }
      const { data } = await supabase.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
      const resolvedRole = (data?.role as AppRole) ?? "admin";
      setRole(resolvedRole);
      if (resolvedRole === "direction") setDirectionViewState(getDirectionViewAs());
    });
  }, [configured]);

  if (role === null) return <div className="page-stack" />;

  if (role === "direction") {
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

  if (role === "it") return <TicketsDashboardView />;
  if (role === "marketing") return <MarketingDashboardView />;
  return <DashboardClient />;
}
