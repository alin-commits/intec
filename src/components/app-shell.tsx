"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { roleLabels } from "@/lib/constants";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { AppRole } from "@/lib/types";

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

const navigation = [
  { href: "/dashboard", label: "Dashboard", icon: DashboardIcon },
  { href: "/consultas", label: "Consultas", icon: ConsultasIcon },
  { href: "/leads", label: "Leads", icon: LeadsIcon },
  { href: "/campanas", label: "Campañas", icon: CampanasIcon },
  { href: "/unidades", label: "Unidades", icon: UnidadesIcon },
  { href: "/usuarios", label: "Usuarios", icon: UsuariosIcon, adminOnly: true },
];

const pageTitles: Record<string, string> = {
  "/dashboard": "Actividad comercial",
  "/consultas": "Consultas",
  "/leads": "Leads",
  "/campanas": "Campañas",
  "/unidades": "Unidades de negocio",
  "/usuarios": "Usuarios",
};

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const configured = isSupabaseConfigured();
  const [profile, setProfile] = useState<{ fullName: string; role: AppRole }>(() => ({ fullName: "Alín", role: "admin" }));

  useEffect(() => {
    if (!configured) return;
    let active = true;
    async function loadProfile() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !active) return;
      const { data } = await supabase.from("profiles").select("full_name, role").eq("id", user.id).maybeSingle();
      if (data && active) {
        setProfile({ fullName: data.full_name || user.email || "Usuario", role: data.role as AppRole });
      }
    }
    void loadProfile();
    return () => { active = false; };
  }, [configured]);

  const initials = useMemo(() => profile.fullName.split(/\s+/).map((part) => part.charAt(0)).join("").slice(0, 2).toUpperCase(), [profile.fullName]);
  const title = Object.entries(pageTitles).find(([path]) => pathname.startsWith(path))?.[1] ?? "Actividad comercial";

  async function signOut() {
    if (configured) {
      await createClient().auth.signOut();
      router.replace("/login");
      router.refresh();
    } else {
      router.push("/login");
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/dashboard" className="brand">
          <span className="brand-mark">I</span>
          <span><strong>Intec</strong><small>Commercial Hub</small></span>
        </Link>
        <nav>
          {navigation.filter((item) => !item.adminOnly || profile.role === "admin").map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link href={item.href} key={item.href} className={active ? "nav-link active" : "nav-link"}>
                <span className="nav-icon"><Icon /></span>{item.label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="avatar">{initials}</div>
          <div><strong>{profile.fullName}</strong><small>{roleLabels[profile.role]}</small></div>
          <button type="button" className="sidebar-logout" onClick={signOut}>Salir</button>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div><span className="eyebrow">Panel interno</span><h1>{title}</h1></div>
          <div className="topbar-actions">
            {!configured ? <span className="demo-badge">Modo demostración</span> : <span className="live-badge">Datos conectados</span>}
            <Link href="/consultas" className="button button-primary">Registrar consulta</Link>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
