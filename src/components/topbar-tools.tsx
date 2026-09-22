"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { BellIcon, ClockIcon, CrmIcon, LeadsIcon, MegaphoneIcon, SearchIcon, TicketsIcon } from "@/components/icons";
import { SendAnnouncementModal } from "@/components/send-announcement-modal";
import { SentAnnouncementsModal } from "@/components/sent-announcements-modal";
import { Toast } from "@/components/ui/toast";
import { ANNOUNCEMENT_SENDER_ROLES, CRM_ROLES, LEADS_ROLES, hasAnyRole } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import { OPEN_TICKET_STATUSES } from "@/lib/tickets/map";
import { TICKET_VIEW_ROLES } from "@/lib/tickets/constants";
import { sanitizeSearchTerm } from "@/lib/search-term";
import type { AppRole } from "@/lib/types";

const STALE_LEAD_DAYS = 3;
const STALE_TICKET_DAYS = 3;
const SEARCH_LIMIT = 5;

function useClickOutside(ref: RefObject<HTMLElement | null>, onOutside: () => void) {
  useEffect(() => {
    function handle(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onOutside();
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [ref, onOutside]);
}

// ---------- Notifications ----------

type Alert = { key: string; label: string; count: number; href: string; icon: ReactNode; urgent: boolean };
type Message = { id: string; title: string; body: string; senderName: string; createdAt: string; unread: boolean };

const MESSAGE_LIMIT = 20;
const MESSAGE_POLL_MS = 2 * 60 * 1000;

function timeAgo(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "ayer" : `hace ${days} días`;
}

export function NotificationsBell({ roles }: { roles: AppRole[] }) {
  const pathname = usePathname();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [open, setOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [viewingSent, setViewingSent] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pollTick, setPollTick] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dismissToast = useCallback(() => setToast(null), []);
  const closePanel = useCallback(() => {
    setOpen((wasOpen) => {
      // Messages seen while the panel was open stop counting as unread once it closes.
      if (wasOpen) setMessages((current) => current.map((message) => ({ ...message, unread: false })));
      return false;
    });
  }, []);
  useClickOutside(wrapperRef, closePanel);
  const rolesKey = roles.join(",");
  const canSend = hasAnyRole(roles, ANNOUNCEMENT_SENDER_ROLES);

  useEffect(() => {
    const timer = setInterval(() => setPollTick((tick) => tick + 1), MESSAGE_POLL_MS);
    return () => clearInterval(timer);
  }, []);

  // Re-checked on every navigation so the badge clears once something is dealt with.
  useEffect(() => {
    let active = true;
    void (async () => {
      const supabase = createClient();
      // Dirección gets no operational alerts; a combined role keeps those of its other role.
      const alertRoles = roles.filter((role) => role !== "direction");
      const canLeads = hasAnyRole(alertRoles, LEADS_ROLES);
      const canTickets = hasAnyRole(alertRoles, TICKET_VIEW_ROLES);
      const leadsBefore = new Date(Date.now() - STALE_LEAD_DAYS * 86400000).toISOString();
      const ticketsBefore = new Date(Date.now() - STALE_TICKET_DAYS * 86400000).toISOString();
      // A pure commercial is alerted about the leads they own; everyone else sees all of them.
      const onlyOwnLeads = alertRoles.includes("commercial") && !hasAnyRole(alertRoles, ["admin", "viewer", "marketing"]);
      const { data: { user } } = await supabase.auth.getUser();
      let staleLeadsQuery = supabase.from("leads").select("id", { count: "exact", head: true }).eq("status", "new").lt("created_at", leadsBefore);
      if (onlyOwnLeads && user) staleLeadsQuery = staleLeadsQuery.eq("assigned_to", user.id);
      const [staleLeads, urgentTickets, staleTickets, received] = await Promise.all([
        canLeads ? staleLeadsQuery : null,
        canTickets ? supabase.from("tickets").select("id", { count: "exact", head: true }).eq("priority", "high").in("status", OPEN_TICKET_STATUSES).is("archived_at", null) : null,
        canTickets ? supabase.from("tickets").select("id", { count: "exact", head: true }).in("status", OPEN_TICKET_STATUSES).is("archived_at", null).lt("created_at", ticketsBefore) : null,
        user
          ? supabase
            .from("announcements")
            .select("id, title, body, sender_name, created_at, announcement_recipients!inner(read_at)")
            .eq("announcement_recipients.recipient_id", user.id)
            .is("announcement_recipients.dismissed_at", null)
            .order("created_at", { ascending: false })
            .limit(MESSAGE_LIMIT)
          : null,
      ]);
      if (!active) return;
      const next: Alert[] = [];
      if (staleLeads?.count) next.push({ key: "leads", label: `${onlyOwnLeads ? "Tus leads" : "Leads"} sin contactar desde hace más de ${STALE_LEAD_DAYS} días`, count: staleLeads.count, href: onlyOwnLeads ? "/leads?owner=mine" : "/leads", icon: <LeadsIcon />, urgent: false });
      if (urgentTickets?.count) next.push({ key: "urgent", label: "Tickets de prioridad alta abiertos", count: urgentTickets.count, href: "/tickets", icon: <TicketsIcon />, urgent: true });
      if (staleTickets?.count) next.push({ key: "stale", label: `Tickets abiertos desde hace más de ${STALE_TICKET_DAYS} días`, count: staleTickets.count, href: "/tickets", icon: <ClockIcon />, urgent: false });
      setAlerts(next);
      const rows = (received?.data ?? []) as { id: string; title: string; body: string; sender_name: string; created_at: string; announcement_recipients: { read_at: string | null }[] }[];
      setMessages(rows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        senderName: row.sender_name,
        createdAt: row.created_at,
        unread: !row.announcement_recipients[0]?.read_at,
      })));
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rolesKey stands in for roles
  }, [rolesKey, pathname, pollTick]);

  const unreadIds = messages.filter((message) => message.unread).map((message) => message.id);
  const total = alerts.reduce((sum, alert) => sum + alert.count, 0) + unreadIds.length;

  function togglePanel() {
    if (open) {
      closePanel();
      return;
    }
    setOpen(true);
    // Unread messages keep their highlight while the panel stays open.
    if (unreadIds.length) void createClient().rpc("mark_announcements_read", { announcement_ids: unreadIds });
  }

  // Removes the notices from this user's bell only; other recipients keep theirs.
  async function dismissMessages(ids: string[]) {
    setMessages((current) => current.filter((message) => !ids.includes(message.id)));
    const { error } = await createClient().rpc("dismiss_announcements", { announcement_ids: ids });
    if (error) {
      setToast("No se pudo borrar el aviso. Inténtalo de nuevo.");
      setPollTick((tick) => tick + 1);
    }
  }

  return (
    <div className="topbar-popover" ref={wrapperRef}>
      <button type="button" className="icon-button topbar-icon-button" aria-label={total ? `${total} avisos` : "Sin avisos"} aria-expanded={open} onClick={togglePanel}>
        <BellIcon />
        {total ? <span className="topbar-badge">{total > 99 ? "99+" : total}</span> : null}
      </button>
      {open ? (
        <div className="popover-panel popover-panel-notices" role="dialog" aria-label="Avisos">
          <div className="popover-header">
            <strong className="popover-title">Avisos</strong>
            {canSend ? (
              <div className="popover-header-actions">
                <button type="button" className="button button-secondary button-compact" onClick={() => { closePanel(); setViewingSent(true); }}>
                  Enviados
                </button>
                <button type="button" className="button button-primary button-compact" onClick={() => { closePanel(); setComposing(true); }}>
                  <MegaphoneIcon /> Enviar aviso
                </button>
              </div>
            ) : null}
          </div>

          {messages.length ? (
            <>
              <div className="notice-section-head">
                <span className="search-group-title">Mensajes</span>
                {messages.length > 1 ? (
                  <button type="button" className="notice-clear-all" onClick={() => void dismissMessages(messages.map((message) => message.id))}>Borrar todos</button>
                ) : null}
              </div>
              <ul className="popover-list">
                {messages.map((message) => (
                  <li key={message.id} className={message.unread ? "notice-message notice-message-unread" : "notice-message"}>
                    <div className="notice-message-head">
                      <strong>{message.title}</strong>
                      <small>{timeAgo(message.createdAt)}</small>
                      <button type="button" className="notice-dismiss" aria-label={`Borrar el aviso «${message.title}»`} title="Borrar aviso" onClick={() => void dismissMessages([message.id])}>×</button>
                    </div>
                    <p>{message.body}</p>
                    <small className="notice-message-sender">De {message.senderName}</small>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {alerts.length ? (
            <>
              {messages.length ? <span className="search-group-title">Pendientes</span> : null}
              <ul className="popover-list">
                {alerts.map((alert) => (
                  <li key={alert.key}>
                    <Link href={alert.href} onClick={closePanel} className={alert.urgent ? "popover-item popover-item-urgent" : "popover-item"}>
                      <span className="popover-icon">{alert.icon}</span>
                      <span className="popover-text">{alert.label}</span>
                      <strong>{alert.count}</strong>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {!alerts.length && !messages.length ? <p className="muted popover-empty">Todo al día: no hay nada pendiente.</p> : null}
        </div>
      ) : null}
      {canSend ? <SendAnnouncementModal open={composing} onClose={() => setComposing(false)} onSent={setToast} /> : null}
      {canSend ? <SentAnnouncementsModal open={viewingSent} onClose={() => setViewingSent(false)} /> : null}
      <Toast message={toast} onDismiss={dismissToast} />
    </div>
  );
}

// ---------- Global search ----------

type SearchResult = { key: string; group: "Contactos CRM" | "Leads" | "Tickets"; title: string; detail: string; href: string };

export function GlobalSearch({ roles }: { roles: AppRole[] }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  useClickOutside(wrapperRef, () => setOpen(false));
  const rolesKey = roles.join(",");
  const cleaned = sanitizeSearchTerm(term);

  useEffect(() => {
    if (cleaned.length < 2) return;
    let active = true;
    const timer = setTimeout(async () => {
      const supabase = createClient();
      const like = `%${cleaned}%`;
      const [crm, leads, tickets] = await Promise.all([
        hasAnyRole(roles, CRM_ROLES) ? supabase.from("crm_contacts").select("id, full_name, company_name").or(`full_name.ilike.${like},company_name.ilike.${like}`).limit(SEARCH_LIMIT) : null,
        hasAnyRole(roles, LEADS_ROLES) ? supabase.from("leads").select("id, contact_name, client_company_name, email").or(`contact_name.ilike.${like},client_company_name.ilike.${like},email.ilike.${like},phone.ilike.${like}`).limit(SEARCH_LIMIT) : null,
        hasAnyRole(roles, TICKET_VIEW_ROLES) ? supabase.from("tickets").select("id, ticket_number, title, reporter_name").is("archived_at", null).or(`ticket_number.ilike.${like},title.ilike.${like},reporter_name.ilike.${like}`).limit(SEARCH_LIMIT) : null,
      ]);
      if (!active) return;
      const query = encodeURIComponent(cleaned);
      setResults([
        ...(crm?.data ?? []).map((row) => ({ key: `crm-${row.id}`, group: "Contactos CRM" as const, title: row.full_name, detail: row.company_name ?? "", href: `/crm?q=${encodeURIComponent(row.full_name)}` })),
        ...(leads?.data ?? []).map((row) => ({ key: `lead-${row.id}`, group: "Leads" as const, title: row.contact_name || row.client_company_name || "Lead", detail: [row.client_company_name, row.email].filter(Boolean).join(" · "), href: `/leads?q=${query}` })),
        ...(tickets?.data ?? []).map((row) => ({ key: `ticket-${row.id}`, group: "Tickets" as const, title: `${row.ticket_number} · ${row.title}`, detail: row.reporter_name, href: `/tickets/${row.id}` })),
      ]);
    }, 300);
    return () => { active = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rolesKey stands in for roles
  }, [cleaned, rolesKey]);

  const visibleResults = cleaned.length < 2 ? null : results;
  const groups = (["Contactos CRM", "Leads", "Tickets"] as const)
    .map((group) => ({ group, items: (visibleResults ?? []).filter((item) => item.group === group) }))
    .filter((entry) => entry.items.length > 0);

  function reset() {
    setOpen(false);
    setTerm("");
    setResults(null);
  }

  return (
    <div className="topbar-popover topbar-search" ref={wrapperRef}>
      <label className="search-field">
        <SearchIcon />
        <input
          type="search"
          value={term}
          placeholder="Buscar contacto, lead o ticket…"
          aria-label="Buscar en toda la plataforma"
          onFocus={() => setOpen(true)}
          onChange={(event) => { setTerm(event.target.value); setOpen(true); }}
          onKeyDown={(event) => { if (event.key === "Escape") reset(); }}
        />
      </label>
      {open && cleaned.length >= 2 ? (
        <div className="popover-panel popover-panel-wide" role="listbox" aria-label="Resultados de búsqueda">
          {visibleResults === null ? (
            <p className="muted popover-empty">Buscando…</p>
          ) : groups.length === 0 ? (
            <p className="muted popover-empty">Sin resultados para «{cleaned}».</p>
          ) : (
            groups.map(({ group, items }) => (
              <div key={group} className="search-group">
                <span className="search-group-title">{group}</span>
                <ul className="popover-list">
                  {items.map((item) => (
                    <li key={item.key}>
                      <Link href={item.href} onClick={reset} className="popover-item">
                        <span className="popover-icon">{group === "Tickets" ? <TicketsIcon /> : group === "Leads" ? <LeadsIcon /> : <CrmIcon />}</span>
                        <span className="popover-text"><strong>{item.title}</strong>{item.detail ? <small>{item.detail}</small> : null}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
