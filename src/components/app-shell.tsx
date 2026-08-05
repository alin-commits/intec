"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const navigation = [
  { href: "/dashboard", label: "Dashboard", icon: "▦" },
  { href: "/consultas", label: "Consultas", icon: "＋" },
  { href: "/leads", label: "Leads", icon: "◎" },
  { href: "/campanas", label: "Campañas", icon: "◇" },
  { href: "/unidades", label: "Unidades", icon: "▤" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/dashboard" className="brand">
          <span className="brand-mark">I</span>
          <span><strong>Intec</strong><small>Commercial Hub</small></span>
        </Link>
        <nav>
          {navigation.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link href={item.href} key={item.href} className={active ? "nav-link active" : "nav-link"}>
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="avatar">AM</div>
          <div><strong>Alín</strong><small>Administrador</small></div>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div>
            <span className="eyebrow">Panel interno</span>
            <h1>Actividad comercial</h1>
          </div>
          <div className="topbar-actions">
            <span className="demo-badge">Modo demostración</span>
            <Link href="/consultas" className="button button-primary">Registrar consulta</Link>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
