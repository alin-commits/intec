"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { roleLabels } from "@/lib/constants";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { AppRole } from "@/lib/types";

const navigation = [
  { href: "/dashboard", label: "Dashboard", icon: "▦" },
  { href: "/consultas", label: "Consultas", icon: "＋" },
  { href: "/leads", label: "Leads", icon: "◎" },
  { href: "/campanas", label: "Campañas", icon: "◇" },
  { href: "/unidades", label: "Unidades", icon: "▤" },
  { href: "/usuarios", label: "Usuarios", icon: "◉", adminOnly: true },
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
            return (
              <Link href={item.href} key={item.href} className={active ? "nav-link active" : "nav-link"}>
                <span className="nav-icon">{item.icon}</span>{item.label}
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
