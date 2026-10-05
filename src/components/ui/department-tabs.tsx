"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { hasAnyRole } from "@/lib/constants";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { loadCurrentProfile } from "@/lib/supabase/current-profile";
import type { AppRole } from "@/lib/types";
import { PageLoader } from "./page-loader";

/*
  Un departamento con sus páginas en pestañas, como el panel de Ventas: una
  sola entrada en el menú y, dentro, una pestaña por página. Cada persona ve
  las pestañas que su rol permite. La pestaña va en la dirección (?p=tesoreria)
  para que al recargar o al mandar el enlace se vea lo mismo.
*/

export type DepartmentPage = {
  key: string;
  label: string;
  /** Quién la ve; sin esto, todos los que entran al departamento. */
  roles?: AppRole[];
  /** Lo que se pinta; `go` cambia de pestaña (por ejemplo, "configura el banco"). */
  render: (go: (key: string) => void) => ReactNode;
};

export function DepartmentTabs({ pages, initial, label }: { pages: DepartmentPage[]; initial: string | null; label: string }) {
  const configured = isSupabaseConfigured();
  const [roles, setRoles] = useState<AppRole[] | null>(configured ? null : ["admin"]);
  const [current, setCurrent] = useState<string | null>(initial);
  const activeTabRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    void loadCurrentProfile().then(
      (profile) => { if (active) setRoles(profile?.roles ?? []); },
      () => { if (active) setRoles([]); },
    );
    return () => { active = false; };
  }, [configured]);

  // Si la pestaña abierta queda fuera de la barra (pantalla estrecha, o se
  // entra con ?p=gastos), la barra se mueve para que se vea.
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current, roles]);

  if (roles === null) return <PageLoader />;
  const visible = pages.filter((page) => !page.roles || hasAnyRole(roles, page.roles));
  if (visible.length === 0) {
    return (
      <div className="page-stack">
        <section className="panel panel-padded">
          <h2>No tienes acceso a esta página</h2>
          <p>Tu rol no tiene permiso para ver este departamento.</p>
        </section>
      </div>
    );
  }
  const active = visible.find((page) => page.key === current) ?? visible[0];

  function go(key: string) {
    setCurrent(key);
    const params = new URLSearchParams(window.location.search);
    if (key === visible[0].key) params.delete("p");
    else params.set("p", key);
    const query = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }

  return (
    <div className="page-stack">
      {visible.length > 1 ? (
        <div className="view-tabs sales-tabs department-tabs" role="tablist" aria-label={label}>
          {visible.map((page) => (
            <button
              key={page.key}
              type="button"
              role="tab"
              aria-selected={page.key === active.key}
              ref={page.key === active.key ? activeTabRef : undefined}
              className={page.key === active.key ? "view-tab active" : "view-tab"}
              onClick={() => go(page.key)}
            >
              {page.label}
            </button>
          ))}
        </div>
      ) : null}
      {/* Sin key: al pasar entre pestañas de una misma pantalla (Remesas y Tesorería)
          no se vuelve a cargar lo que ya estaba cargado. */}
      <div role="tabpanel" aria-label={active.label}>
        {active.render(go)}
      </div>
    </div>
  );
}
