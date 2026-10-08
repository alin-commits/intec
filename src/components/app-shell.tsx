"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CampanasIcon, ConsultasIcon, CrmIcon, DashboardIcon, EuroIcon, InboxIcon, KeyIcon, LeadsIcon, LogoutIcon, TarjetasIcon, TicketsIcon, UnidadesIcon, UsuariosIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { AccountSwitcher, PreviewBanner, type CuentaDePrueba } from "@/components/account-switcher";
import { GlobalSearch, NotificationsBell } from "@/components/topbar-tools";
import { TabBarsWheel } from "@/components/ui/tab-bars-wheel";
import { displayName } from "@/lib/format";
import { CAMPAIGNS_ROLES, CARDS_ROLES, CONSULTAS_ROLES, CRM_ROLES, DASHBOARD_ROLES, LEADS_ROLES, PAYMENTS_ROLES, SALES_ROLES, UNITS_ROLES, hasAnyRole, roleLabels } from "@/lib/constants";
import { TICKET_VIEW_ROLES } from "@/lib/tickets/constants";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { forgetCurrentProfile, loadCurrentProfile } from "@/lib/supabase/current-profile";
import type { AppRole } from "@/lib/types";

const navigation: { href: string; label: string; icon: () => ReactNode; roles?: AppRole[] }[] = [
  { href: "/dashboard", label: "Inicio", icon: DashboardIcon, roles: DASHBOARD_ROLES },
  { href: "/ventas", label: "Ventas", icon: EuroIcon, roles: SALES_ROLES },
  // Lo del día y los pagos por confirming: un departamento, una entrada con pestañas.
  { href: "/administracion", label: "Administración", icon: InboxIcon, roles: PAYMENTS_ROLES },
  { href: "/consultas", label: "Consultas", icon: ConsultasIcon, roles: CONSULTAS_ROLES },
  { href: "/leads", label: "Leads", icon: LeadsIcon, roles: LEADS_ROLES },
  { href: "/crm", label: "CRM", icon: CrmIcon, roles: CRM_ROLES },
  // Campañas, redes sociales, Meta Ads, mailing y gastos: un departamento, una entrada con pestañas.
  { href: "/marketing", label: "Marketing", icon: CampanasIcon, roles: CAMPAIGNS_ROLES },
  { href: "/unidades", label: "Unidades", icon: UnidadesIcon, roles: UNITS_ROLES },
  { href: "/tickets", label: "Tickets", icon: TicketsIcon, roles: TICKET_VIEW_ROLES },
  { href: "/tarjetas", label: "Tarjetas", icon: TarjetasIcon, roles: CARDS_ROLES },
  // Everyone with an account can reach the vault; what they see inside is decided per credential.
  { href: "/contrasenas", label: "Contraseñas", icon: KeyIcon },
  { href: "/usuarios", label: "Usuarios", icon: UsuariosIcon, roles: ["admin"] },
];

const pageTitles: Record<string, string> = {
  "/dashboard": "Actividad comercial",
  "/ventas": "Ventas de Sage",
  "/administracion": "Administración",
  "/consultas": "Consultas",
  "/leads": "Leads",
  "/crm": "CRM",
  "/marketing": "Marketing",
  "/unidades": "Unidades de negocio",
  "/tickets": "Tickets informáticos",
  "/tarjetas": "Tarjetas de visita",
  "/contrasenas/salud": "Salud del gestor",
  "/contrasenas/accesos": "Accesos al gestor",
  "/contrasenas/auditoria": "Auditoría del gestor",
  "/contrasenas": "Gestor de contraseñas",
  "/usuarios": "Usuarios",
};

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const configured = isSupabaseConfigured();
  // Sin roles hasta saberlos: suponer "admin" enseñaba el menú entero, "Usuarios"
  // incluido, durante la carga de cada recarga dura.
  const [profile, setProfile] = useState<{ fullName: string; roles: AppRole[]; isPreview: boolean }>(() => ({ fullName: "", roles: [], isPreview: false }));
  // Las cuentas de prueba solo las pide quien puede usarlas.
  const [cuentasDePrueba, setCuentasDePrueba] = useState<CuentaDePrueba[]>([]);
  const [hasAssignedCard, setHasAssignedCard] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setMobileNavOpen(false);
  }

  useEffect(() => {
    if (!configured) return;
    let active = true;
    async function loadProfile() {
      const current = await loadCurrentProfile();
      if (!current || !active) return;
      setProfile({ fullName: displayName(current.fullName), roles: current.roles, isPreview: current.isPreview });
      const supabase = createClient();
      const { data: assignedCard } = await supabase.from("business_cards").select("id").eq("assigned_user_id", current.id).limit(1).maybeSingle();
      if (!active) return;
      setHasAssignedCard(Boolean(assignedCard));

      if (!current.isPreview && hasAnyRole(current.roles, ["owner", "admin"])) {
        const { data: cuentas } = await supabase
          .from("profiles")
          .select("id, full_name, roles")
          .eq("is_preview", true)
          .eq("is_active", true)
          .order("full_name");
        if (!active) return;
        setCuentasDePrueba((cuentas ?? []).map((fila) => ({
          id: String(fila.id),
          fullName: String(fila.full_name ?? "Cuenta de prueba"),
          roles: (fila.roles ?? []) as AppRole[],
        })));
      }
    }
    void loadProfile();
    return () => { active = false; };
  }, [configured]);

  const title = Object.entries(pageTitles).find(([path]) => pathname.startsWith(path))?.[1] ?? "Actividad comercial";
  const isDashboard = pathname.startsWith("/dashboard");
  const firstName = profile.fullName.split(" ")[0];
  const initials = profile.fullName.split(" ").filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("");
  /*
   * Dirección ve el menú entero, como todo el mundo: las pantallas que la
   * nombran en su lista de roles. Antes se filtraba por el departamento elegido
   * y había que cambiar de modo para llegar a Tickets, a Consultas o a RRSS —
   * tres viajes para dar una vuelta por la empresa, cuando de todas formas solo
   * mira. Además el menú de Informática y el de Marketing le enseñaban Tarjetas,
   * que es una página que le deniega la entrada. Qué panel ve en Inicio se
   * elige ahora ahí mismo, en sus pestañas.
   */
  const navRoles: AppRole[] = profile.roles;
  const showConsultaActions = hasAnyRole(profile.roles, ["commercial"]) || (hasAnyRole(profile.roles, ["admin"]) && pathname.startsWith("/consultas"));

  async function signOut() {
    if (configured) {
      forgetCurrentProfile();
      await createClient().auth.signOut();
      router.replace("/login");
      router.refresh();
    } else {
      router.push("/login");
    }
  }

  return (
    <div className="app-shell">
      <TabBarsWheel />
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
          {/* Only shown in the mobile menu, where the topbar just shows the initials. */}
          <div className="sidebar-user">
            <span className="user-avatar" aria-hidden="true">{initials}</span>
            <div className="user-chip-text">
              <strong>{profile.fullName}</strong>
              <small>{profile.roles.map((role) => roleLabels[role]).join(" + ")}</small>
            </div>
          </div>
          <button type="button" className="nav-link sidebar-logout" onClick={signOut}>
            <span className="nav-icon"><LogoutIcon /></span>Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="main-content">
        {profile.isPreview ? <PreviewBanner fullName={profile.fullName} roles={profile.roles} /> : null}
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
            <AccountSwitcher
              fullName={profile.fullName}
              roles={profile.roles}
              initials={initials}
              isPreview={profile.isPreview}
              cuentas={cuentasDePrueba}
              onSignOut={() => void signOut()}
            />
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
