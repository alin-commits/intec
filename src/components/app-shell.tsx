"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Logo } from "@/components/logo";
import { roleLabels } from "@/lib/constants";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { getDirectionViewAs, setDirectionViewAs, type DirectionDepartment } from "@/lib/direction-view";
import type { AppRole } from "@/lib/types";

const departmentLabels: Record<DirectionDepartment, string> = {
  commercial: "Comercial",
  it: "Informática",
  marketing: "Marketing",
};

function DashboardIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2.5" y="2.5" width="6.3" height="6.3" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11.2" y="2.5" width="6.3" height="6.3" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2.5" y="11.2" width="6.3" height="6.3" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11.2" y="11.2" width="6.3" height="6.3" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ConsultasIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2.8" y="3.5" width="14.4" height="9.6" rx="2.4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 13.1v3.4l3.6-3.4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M7 8.3h.01M10 8.3h.01M13 8.3h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function LeadsIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="6.8" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="10" cy="10" r="3.4" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="10" cy="10" r="1" fill="currentColor" />
    </svg>
  );
}

function CampanasIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5 2.8v14.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M5 4h8.3c.9 0 1.3 1 .7 1.7L12 8l2 2.3c.6.7.2 1.7-.7 1.7H5V4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function UnidadesIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 2.5 17 6.3 10 10 3 6.3 10 2.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M3 10.2 10 14l7-3.8" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M3 13.9 10 17.7l7-3.8" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function UsuariosIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="7.3" cy="6.6" r="2.4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.5 16c0-2.7 2.1-4.3 4.8-4.3s4.8 1.6 4.8 4.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="14.3" cy="7.2" r="1.9" stroke="currentColor" strokeWidth="1.4" />
      <path d="M12.6 11.2c1.9-.4 4.9.6 4.9 3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function TicketsIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 6.4c0-1 .8-1.9 1.9-1.9h10.2c1 0 1.9.8 1.9 1.9v1.2a1.7 1.7 0 0 0 0 3.2v1.2c0 1-.8 1.9-1.9 1.9H4.9c-1 0-1.9-.8-1.9-1.9v-1.2a1.7 1.7 0 0 0 0-3.2V6.4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8.2 4.5v11" stroke="currentColor" strokeWidth="1.5" strokeDasharray="1.6 1.6" />
    </svg>
  );
}

const navigation: { href: string; label: string; icon: () => ReactNode; roles?: AppRole[] }[] = [
  { href: "/dashboard", label: "Dashboard", icon: DashboardIcon },
  { href: "/consultas", label: "Consultas", icon: ConsultasIcon, roles: ["admin", "commercial", "viewer", "direction"] },
  { href: "/leads", label: "Leads", icon: LeadsIcon, roles: ["admin", "commercial", "marketing", "viewer", "direction"] },
  { href: "/campanas", label: "Campañas", icon: CampanasIcon, roles: ["admin", "marketing", "viewer", "direction"] },
  { href: "/unidades", label: "Unidades", icon: UnidadesIcon, roles: ["admin", "viewer"] },
  { href: "/tickets", label: "Tickets", icon: TicketsIcon, roles: ["admin", "it", "direction"] },
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
  "/campanas": "Campañas",
  "/unidades": "Unidades de negocio",
  "/tickets": "Tickets informáticos",
  "/usuarios": "Usuarios",
};

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const configured = isSupabaseConfigured();
  const [profile, setProfile] = useState<{ fullName: string; role: AppRole }>(() => ({ fullName: "Alín", role: "admin" }));
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
      const { data } = await supabase.from("profiles").select("full_name, role").eq("id", user.id).maybeSingle();
      if (data && active) {
        const rawName = data.full_name || user.email || "Usuario";
        setProfile({ fullName: rawName.includes("@") ? nameFromEmail(rawName) : rawName, role: data.role as AppRole });
      }
    }
    void loadProfile();
    return () => { active = false; };
  }, [configured]);

  const title = Object.entries(pageTitles).find(([path]) => pathname.startsWith(path))?.[1] ?? "Actividad comercial";
  const navRole: AppRole | null = profile.role === "direction" ? directionView : profile.role;

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
      <aside className={mobileNavOpen ? "sidebar mobile-open" : "sidebar"}>
        <div className="sidebar-top">
          <Link href="/dashboard" className="brand">
            <span className="brand-logo-chip"><Logo className="brand-logo" priority /></span>
            <small>Commercial Hub</small>
          </Link>
          <button type="button" className="sidebar-toggle" aria-label={mobileNavOpen ? "Cerrar menú" : "Abrir menú"} aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((current) => !current)}>
            <span /><span /><span />
          </button>
        </div>
        <nav>
          {navigation.filter((item) => !item.roles || (navRole !== null && item.roles.includes(navRole))).map((item) => {
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
          {profile.role === "direction" ? (
            <button type="button" className="sidebar-department-switch" onClick={changeDepartment}>
              {directionView ? `Viendo: ${departmentLabels[directionView]} · Cambiar` : "Elegir departamento"}
            </button>
          ) : null}
          <div className="sidebar-footer">
            <div><strong>{profile.fullName}</strong><small>{roleLabels[profile.role]}</small></div>
            <button type="button" className="sidebar-logout" onClick={signOut}>Salir</button>
          </div>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div><span className="eyebrow">Panel interno</span><h1>{title}</h1></div>
          <div className="topbar-actions">
            {!configured ? <span className="demo-badge">Modo demostración</span> : <span className="live-badge">Datos conectados</span>}
            {navRole === "admin" || navRole === "commercial" ? <Link href="/consultas?openSale=1" className="button button-secondary">Registrar venta</Link> : null}
            <Link href="/consultas" className="button button-primary">Registrar consulta</Link>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
