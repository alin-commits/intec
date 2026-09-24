"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { hasAnyRole, VAULT_ADMIN_ROLES } from "@/lib/constants";
import { loadCurrentProfile } from "@/lib/supabase/current-profile";

/** Tabs shared by the three vault pages. Salud and Auditoría are for vault admins. */
export function VaultTabs() {
  const pathname = usePathname();
  const [isVaultAdmin, setIsVaultAdmin] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const profile = await loadCurrentProfile();
      if (!active || !profile) return;
      setIsVaultAdmin(hasAnyRole(profile.roles, VAULT_ADMIN_ROLES));
    })();
    return () => { active = false; };
  }, []);

  const tabs = [
    { href: "/contrasenas", label: "Gestor", adminOnly: false },
    { href: "/contrasenas/salud", label: "Salud", adminOnly: true },
    { href: "/contrasenas/accesos", label: "Accesos", adminOnly: true },
    { href: "/contrasenas/auditoria", label: "Auditoría", adminOnly: true },
  ].filter((tab) => !tab.adminOnly || isVaultAdmin);

  return (
    <div className="view-tabs" role="tablist" aria-label="Secciones del gestor de contraseñas">
      {tabs.map((tab) => {
        const active = tab.href === "/contrasenas" ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} role="tab" aria-selected={active} className={active ? "view-tab active" : "view-tab"}>
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
