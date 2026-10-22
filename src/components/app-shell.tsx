"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CampanasIcon, ComprasIcon, ConsultasIcon, CrmIcon, DashboardIcon, EuroIcon, InboxIcon, KeyIcon, LeadsIcon, LogoutIcon, TarjetasIcon, TicketsIcon, UnidadesIcon, UsuariosIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { AccountSwitcher, PreviewBanner, type CuentaDePrueba } from "@/components/account-switcher";
import { AvisoExtension } from "@/components/aviso-extension";
import { PendingLeadsNotice } from "@/components/leads/pending-leads-notice";
import { AvisoCompras } from "@/components/compras/aviso-compras";
import { GlobalSearch, NotificationsBell } from "@/components/topbar-tools";
import { TabBarsWheel } from "@/components/ui/tab-bars-wheel";
import { displayName } from "@/lib/format";
import { CAMPAIGNS_ROLES, CARDS_ROLES, COMPRAS_ROLES, CONSULTAS_ROLES, CRM_ROLES, DASHBOARD_ROLES, LEADS_ROLES, PAYMENTS_ROLES, SALES_ROLES, UNITS_ROLES, hasAnyRole, leTocaElAvisoDeCompras, roleLabels } from "@/lib/constants";
import { TICKET_VIEW_ROLES } from "@/lib/tickets/constants";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { forgetCurrentProfile, loadCurrentProfile } from "@/lib/supabase/current-profile";
import type { AppRole } from "@/lib/types";

type Entrada = { href: string; label: string; icon: () => ReactNode; roles?: AppRole[] };

const CLAVE_DESPLEGADOS = "intec.menu-desplegados";

/** Lo que dejaste abierto la última vez. En el servidor no hay navegador. */
function leerDesplegados(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const crudo = window.localStorage.getItem(CLAVE_DESPLEGADOS);
    const valor = crudo ? (JSON.parse(crudo) as unknown) : null;
    return valor && typeof valor === "object" ? (valor as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/*
  El menú, por departamentos.

  Todo va en su departamento, aunque de momento tenga una sola entrada: así el
  menú se lee igual hoy que cuando Utilidades tenga el asistente de manuales al
  lado del gestor de contraseñas, sin que nada cambie de sitio por el camino.
  Inicio es la excepción, que no es un departamento sino el enlace a casa.

  Los permisos no cambian: cada entrada sigue mirando sus roles, y un
  departamento sin nada visible no aparece. Agrupar es para leer mejor, no para
  dar ni quitar acceso.
*/
const departamentos: { id: string; label: string; entradas: Entrada[] }[] = [
  { id: "inicio", label: "Inicio", entradas: [
    { href: "/dashboard", label: "Inicio", icon: DashboardIcon, roles: DASHBOARD_ROLES },
  ] },
  { id: "comercial", label: "Comercial", entradas: [
    { href: "/ventas", label: "Ventas", icon: EuroIcon, roles: SALES_ROLES },
    { href: "/consultas", label: "Consultas", icon: ConsultasIcon, roles: CONSULTAS_ROLES },
    { href: "/leads", label: "Leads", icon: LeadsIcon, roles: LEADS_ROLES },
    { href: "/crm", label: "CRM", icon: CrmIcon, roles: CRM_ROLES },
  ] },
  { id: "compras", label: "Compras", entradas: [
    { href: "/compras", label: "Compras", icon: ComprasIcon, roles: COMPRAS_ROLES },
  ] },
  // Lo del día y los pagos por confirming: un departamento, una entrada con pestañas.
  { id: "administracion", label: "Administración", entradas: [
    { href: "/administracion", label: "Administración", icon: InboxIcon, roles: PAYMENTS_ROLES },
  ] },
  { id: "marketing", label: "Marketing", entradas: [
    // Campañas, redes sociales, publicidad, mailing y gastos: una entrada con pestañas.
    { href: "/marketing", label: "Marketing", icon: CampanasIcon, roles: CAMPAIGNS_ROLES },
    { href: "/tarjetas", label: "Tarjetas", icon: TarjetasIcon, roles: CARDS_ROLES },
  ] },
  { id: "informatica", label: "Informática", entradas: [
    { href: "/tickets", label: "Tickets", icon: TicketsIcon, roles: TICKET_VIEW_ROLES },
  ] },
  { id: "interno", label: "Interno", entradas: [
    { href: "/unidades", label: "Unidades", icon: UnidadesIcon, roles: UNITS_ROLES },
    { href: "/usuarios", label: "Usuarios", icon: UsuariosIcon, roles: ["admin"] },
  ] },
  // Aquí irá el asistente de manuales. De momento solo el gestor de
  // contraseñas, que lo alcanza cualquiera con cuenta: lo que ve dentro se
  // decide credencial a credencial.
  { id: "utilidades", label: "Utilidades", entradas: [
    { href: "/contrasenas", label: "Contraseñas", icon: KeyIcon },
  ] },
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
  const [profile, setProfile] = useState<{ id: string; fullName: string; roles: AppRole[]; isPreview: boolean }>(() => ({ id: "", fullName: "", roles: [], isPreview: false }));
  // Las cuentas de prueba solo las pide quien puede usarlas.
  const [cuentasDePrueba, setCuentasDePrueba] = useState<CuentaDePrueba[]>([]);
  const [hasAssignedCard, setHasAssignedCard] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  /*
    Qué departamentos has dejado abiertos. Lo que no esté aquí se decide solo:
    abierto si estás dentro, cerrado si no. Se guarda en este navegador, que es
    una comodidad tuya y no un dato de la empresa.
  */
  const [desplegados, setDesplegados] = useState<Record<string, boolean>>(() => leerDesplegados());

  function cambiarDesplegado(id: string, abierto: boolean) {
    setDesplegados((actual) => {
      const siguiente = { ...actual, [id]: abierto };
      try {
        window.localStorage.setItem(CLAVE_DESPLEGADOS, JSON.stringify(siguiente));
      } catch {
        // Sin almacén el menú funciona igual; solo se olvida al recargar.
      }
      return siguiente;
    });
  }
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
      setProfile({ id: current.id, fullName: displayName(current.fullName), roles: current.roles, isPreview: current.isPreview });
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
  // Solo cuentan las palabras que empiezan por letra: "Comercial (prueba)" daba "C(".
  const initials = profile.fullName.split(" ").filter((part) => /^\p{L}/u.test(part)).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("");
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

  /*
    Entrar y encontrarse una página vacía.

    Al iniciar sesión todo el mundo va a Inicio, pero no todos los roles lo
    tienen: compras, administración o un empleado aterrizaban en un panel que
    no es suyo y sin nada que mirar, teniendo que buscar en el menú dónde está
    lo que han venido a hacer. Se les lleva a su primera entrada.
  */
  useEffect(() => {
    if (pathname !== "/dashboard" || profile.roles.length === 0) return;
    if (hasAnyRole(navRoles, DASHBOARD_ROLES)) return;
    const suya = departamentos
      .flatMap((departamento) => departamento.entradas)
      .find((entrada) => entrada.href !== "/dashboard" && (!entrada.roles || hasAnyRole(navRoles, entrada.roles)));
    if (suya) router.replace(suya.href);
  }, [pathname, profile.roles, navRoles, router]);

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
          {departamentos.map((departamento) => {
            const suyas = departamento.entradas.filter((entrada) => {
              if (entrada.href === "/tarjetas" && hasAssignedCard) return true;
              return !entrada.roles || hasAnyRole(navRoles, entrada.roles);
            });
            if (suyas.length === 0) return null;
            // Inicio no es un departamento: es el enlace a casa.
            const suelto = departamento.id === "inicio";

            const enlace = (entrada: Entrada) => {
              const Icon = entrada.icon;
              return (
                <Link href={entrada.href} key={entrada.href}
                  className={pathname.startsWith(entrada.href) ? "nav-link active" : "nav-link"}
                  onClick={() => setMobileNavOpen(false)}>
                  <span className="nav-icon"><Icon /></span>{entrada.label}
                </Link>
              );
            };

            if (suelto) return enlace(suyas[0]);

            const aqui = suyas.some((entrada) => pathname.startsWith(entrada.href));
            const abierto = desplegados[departamento.id] ?? aqui;
            return (
              <div className="nav-grupo" key={departamento.id}>
                <button type="button" className="nav-grupo-titulo" aria-expanded={abierto}
                  onClick={() => cambiarDesplegado(departamento.id, !abierto)}>
                  <span className={abierto ? "nav-grupo-flecha abierta" : "nav-grupo-flecha"} aria-hidden="true" />
                  {departamento.label}
                  {!abierto && aqui ? <span className="nav-grupo-punto" aria-hidden="true" /> : null}
                </button>
                {abierto ? <div className="nav-grupo-enlaces">{suyas.map(enlace)}</div> : null}
              </div>
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
        {/* Va aquí, fuera de lo que el bloqueador esconde: dentro no se vería. */}
        <AvisoExtension />
        {/* Los leads sin tocar se le recuerdan a quien los lleva, no a quien mira. */}
        {configured && profile.id && hasAnyRole(profile.roles, ["commercial"]) ? <PendingLeadsNotice userId={profile.id} /> : null}
        {/*
          Solo a quien lleva compras. Un administrador o dirección entran en
          muchas pantallas al día y esto les saldría una y otra vez por un
          trabajo que no es suyo; el aviso dejaría de leerse en dos días.
          Tampoco sale estando ya en Compras: está para llevarte allí, no para
          taparte la pantalla a la que querías llegar.
        */}
        {configured && profile.id && !pathname.startsWith("/compras") && leTocaElAvisoDeCompras(profile.roles) ? <AvisoCompras userId={profile.id} /> : null}
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
