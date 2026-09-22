"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CampanasIcon, ConsultasIcon, CrmIcon, DashboardIcon, LeadsIcon, LogoutIcon, RrssIcon, TarjetasIcon, TicketsIcon, UnidadesIcon, UsuariosIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { GlobalSearch, NotificationsBell } from "@/components/topbar-tools";
import { CAMPAIGNS_ROLES, CARDS_ROLES, CONSULTAS_ROLES, CRM_ROLES, LEADS_ROLES, RRSS_ROLES, UNITS_ROLES, hasAnyRole, roleLabels } from "@/lib/constants";
import { TICKET_VIEW_ROLES } from "@/lib/tickets/constants";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { getDirectionViewAs, setDirectionViewAs, type DirectionDepartment } from "@/lib/direction-view";
import type { AppRole } from "@/lib/types";

const departmentLabels: Record<DirectionDepartment, string> = {
  commercial: "Comercial",
  it: "Informática",
  marketing: "Marketing",
};

const navigation: { href: string; label: string; icon: () => ReactNode; roles?: AppRole[] }[] = [
  { href: "/dashboard", label: "Inicio", icon: DashboardIcon },
  { href: "/consultas", label: "Consultas", icon: ConsultasIcon, roles: CONSULTAS_ROLES },
  { href: "/leads", label: "Leads", icon: LeadsIcon, roles: LEADS_ROLES },
  { href: "/crm", label: "CRM", icon: CrmIcon, roles: CRM_ROLES },
  { href: "/campanas", label: "Campañas", icon: CampanasIcon, roles: CAMPAIGNS_ROLES },
  { href: "/rrss", label: "RRSS", icon: RrssIcon, roles: RRSS_ROLES },
  { href: "/unidades", label: "Unidades", icon: UnidadesIcon, roles: UNITS_ROLES },
  { href: "/tickets", label: "Tickets", icon: TicketsIcon, roles: TICKET_VIEW_ROLES },
  { href: "/tarjetas", label: "Tarjetas", icon: TarjetasIcon, roles: CARDS_ROLES },
  { href: "/usuarios", label: "Usuarios", icon: UsuariosIcon, roles: ["admin"] },
];

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

const pageTitles: Record<string, string> = {
  "/dashboard": "Actividad comercial",
  "/consultas": "Consultas",
  "/leads": "Leads",
  "/crm": "CRM",
  "/campanas": "Campañas",
  "/rrss": "RRSS y métricas de marketing",
  "/unidades": "Unidades de negocio",
  "/tickets": "Tickets informáticos",
  "/tarjetas": "Tarjetas de visita",
  "/usuarios": "Usuarios",
};

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const configured = isSupabaseConfigured();
  const [profile, setProfile] = useState<{ fullName: string; roles: AppRole[] }>(() => ({ fullName: "Alín", roles: ["admin"] }));
  const [hasAssignedCard, setHasAssignedCard] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [directionView, setDirectionView] = useState<DirectionDepartment | null>(() => getDirectionViewAs());
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setMobileNavOpen(false);
  }

  useEffect(() => {
    function refreshDirectionView() {
      setDirectionView(getDirectionViewAs());
    }
    window.addEventListener("intec-direction-view-change", refreshDirectionView);
    return () => window.removeEventListener("intec-direction-view-change", refreshDirectionView);
  }, []);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    async function loadProfile() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !active) return;
      const [{ data }, { data: assignedCard }] = await Promise.all([
        supabase.from("profiles").select("full_name, roles").eq("id", user.id).maybeSingle(),
        supabase.from("business_cards").select("id").eq("assigned_user_id", user.id).limit(1).maybeSingle(),
      ]);
      if (!active) return;
      if (data) {
        const rawName = data.full_name || user.email || "Usuario";
        setProfile({ fullName: rawName.includes("@") ? nameFromEmail(rawName) : rawName, roles: data.roles as AppRole[] });
      }
      setHasAssignedCard(Boolean(assignedCard));
    }
    void loadProfile();
    return () => { active = false; };
  }, [configured]);

  const title = Object.entries(pageTitles).find(([path]) => pathname.startsWith(path))?.[1] ?? "Actividad comercial";
  const isDashboard = pathname.startsWith("/dashboard");
  const firstName = profile.fullName.split(" ")[0];
  const initials = profile.fullName.split(" ").filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("");
  const isDirection = profile.roles.includes("direction");
  const navRoles: AppRole[] = isDirection ? (directionView ? [directionView] : []) : profile.roles;
  const showConsultaActions = hasAnyRole(profile.roles, ["commercial"]) || (hasAnyRole(profile.roles, ["admin"]) && pathname.startsWith("/consultas"));

  async function signOut() {
    if (configured) {
      await createClient().auth.signOut();
      router.replace("/login");
      router.refresh();
    } else {
      router.push("/login");
    }
  }

  function changeDepartment() {
    setDirectionViewAs(null);
    setDirectionView(null);
    router.push("/dashboard");
  }

  return (
    <div className="app-shell">
      {mobileNavOpen ? <div className="mobile-nav-backdrop" onClick={() => setMobileNavOpen(false)} /> : null}
      <aside className={mobileNavOpen ? "sidebar mobile-open" : "sidebar"}>
        <div className="sidebar-top">
          <Link href="/dashboard" className="brand">
            <Logo className="brand-logo" priority />
            <small>Commercial Hub</small>
          </Link>
          <button type="button" className="sidebar-toggle" aria-label={mobileNavOpen ? "Cerrar menú" : "Abrir menú"} aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((current) => !current)}>
            <span /><span /><span />
          </button>
        </div>
        <nav>
          {navigation.filter((item) => {
            if (item.href === "/tarjetas" && hasAssignedCard) return true;
            return !item.roles || hasAnyRole(navRoles, item.roles);
          }).map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link href={item.href} key={item.href} className={active ? "nav-link active" : "nav-link"}>
                <span className="nav-icon"><Icon /></span>{item.label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          {isDirection ? (
            <button type="button" className="sidebar-department-switch" onClick={changeDepartment}>
              {directionView ? `Viendo: ${departmentLabels[directionView]} · Cambiar` : "Elegir departamento"}
            </button>
          ) : null}
          <button type="button" className="nav-link sidebar-logout" onClick={signOut}>
            <span className="nav-icon"><LogoutIcon /></span>Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          {isDashboard ? (
            <div className="topbar-title">
              <h1>Hola, {firstName}</h1>
              <p>Aquí tienes el resumen de la actividad comercial.</p>
            </div>
          ) : (
            <div className="topbar-title"><h1>{title}</h1></div>
          )}
          <div className="topbar-actions">
            {configured ? (
              <>
                <GlobalSearch roles={profile.roles} />
                <NotificationsBell roles={profile.roles} />
              </>
            ) : <span className="demo-badge">Modo demostración</span>}
            {showConsultaActions ? (
              <>
                <Link href="/consultas?openSale=1" className="button button-secondary">Registrar venta</Link>
                <Link href="/consultas" className="button button-primary">Registrar consulta</Link>
              </>
            ) : null}
            <div className="user-chip" title={profile.fullName}>
              <span className="user-avatar" aria-hidden="true">{initials}</span>
              <div className="user-chip-text">
                <strong>{profile.fullName}</strong>
                <small>{profile.roles.map((role) => roleLabels[role]).join(" + ")}</small>
              </div>
            </div>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
