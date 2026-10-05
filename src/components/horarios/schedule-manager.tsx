"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MonthField } from "@/components/ui/date-field";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { PageLoader } from "@/components/ui/page-loader";
import { SCHEDULE_EDIT_ROLES, SCHEDULE_ROLES, hasAnyRole } from "@/lib/constants";
import { reportSafeError } from "@/lib/errors";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { loadCurrentProfile } from "@/lib/supabase/current-profile";
import { exportSchedulePdf } from "@/lib/horarios/schedule-pdf";
import {
  buildWeek,
  cellLines,
  monthWeekdays,
  weekDays,
  weekNumber,
  weekStartOf,
  weekdayInitial,
  weekdayName,
  type DayCell,
  type DayShift,
  type ExceptionKind,
  type Holiday,
  type ScheduleException,
  type ShiftTemplate,
} from "@/lib/horarios/model";

/*
  El cuadrante de horarios: el mes entero de un vistazo y editable encima.

  Debajo no hay una celda guardada por persona y día —serían más de quinientas
  al mes y nadie las mantendría—, sino el turno habitual de cada uno y las pocas
  cosas que se salen de él. Lo que se ve aquí es el resultado de juntar ambas.

  Se edita como una hoja de cálculo: se elige arriba qué marcar y se pinta sobre
  las celdas, arrastrando si son varias. Todo lo pintado se guarda de una vez al
  soltar el ratón, no celda a celda.
*/

type Department = { id: string; name: string; sort_order: number };
type Member = { id: string; department_id: string; display_name: string; sort_order: number; is_active: boolean };
type WeekNote = { week_start: string; note: string };
/** Lo que se puede pintar. "habitual" borra la excepción y deja el turno de siempre. */
type Pincel = ExceptionKind | "habitual";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const todayMonth = () => new Date().toISOString().slice(0, 7);

const PINCELES: { kind: Pincel; label: string; clase: string }[] = [
  { kind: "habitual", label: "Turno de siempre", clase: "p-habitual" },
  { kind: "vacaciones", label: "Vacaciones", clase: "p-ausencia" },
  { kind: "baja", label: "Baja", clase: "p-ausencia" },
  { kind: "permiso", label: "Permiso", clase: "p-ausencia" },
  { kind: "tarde_libre", label: "Tarde libre", clase: "p-tarde" },
  { kind: "horario", label: "Otro horario", clase: "p-horario" },
  { kind: "no_trabaja", label: "No trabaja", clase: "p-libre" },
];

const claseDe = (cell: DayCell) => {
  if (cell.kind === "festivo") return "hc is-festivo";
  if (cell.kind === "ausencia") return "hc is-ausencia";
  if (cell.kind === "libre") return "hc is-libre";
  return cell.tardeLibre ? "hc is-tarde-libre" : "hc";
};

/** "08:00 - 13:30" no cabe en una columna de día: aquí se acorta a "8–13:30". */
const corto = (linea: string) => linea.replace(/\s*-\s*/, "–").replace(/:00/g, "").replace(/\b0(\d)/g, "$1");

export function ScheduleManager() {
  const configured = isSupabaseConfigured();
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">(configured ? "checking" : "allowed");
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(configured);
  const [message, setMessage] = useState<string | null>(null);
  const [faltaMigracion, setFaltaMigracion] = useState(false);

  const [month, setMonth] = useState(todayMonth);
  const [loadedMonth, setLoadedMonth] = useState<string | null>(null);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [exceptions, setExceptions] = useState<ScheduleException[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [notes, setNotes] = useState<WeekNote[]>([]);

  const [pincel, setPincel] = useState<Pincel>("vacaciones");
  const [horas, setHoras] = useState({ m1: "08:00", m2: "14:00", t1: "", t2: "" });
  /** Lo pintado en el arrastre en curso, para verlo antes de guardarlo. */
  const [pintadas, setPintadas] = useState<Set<string>>(new Set());
  const pintando = useRef(false);
  const acumulado = useRef<Set<string>>(new Set());
  const guardar = useRef<() => void>(() => {});

  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [personalOpen, setPersonalOpen] = useState(false);
  const [nuevo, setNuevo] = useState({ nombre: "", departamento: "" });
  const [borrando, setBorrando] = useState<Member | null>(null);
  /** Lo que había antes de la última pintada, para poder volver atrás. */
  const [deshacer, setDeshacer] = useState<{ celdas: string[]; previas: ScheduleException[] } | null>(null);
  const [filtroDepartamento, setFiltroDepartamento] = useState("all");
  const [busqueda, setBusqueda] = useState("");

  const dias = useMemo(() => monthWeekdays(month), [month]);

  useEffect(() => {
    if (!configured) return;
    void (async () => {
      const profile = await loadCurrentProfile();
      if (!profile || !hasAnyRole(profile.roles, SCHEDULE_ROLES)) { setAccess("denied"); setLoading(false); return; }
      setAccess("allowed");
      setCanEdit(hasAnyRole(profile.roles, SCHEDULE_EDIT_ROLES));
      await load(month);
      setLoading(false);
    })();
  }, [configured]);

  useEffect(() => {
    if (!configured || access !== "allowed" || loadedMonth === month) return;
    void load(month);
  }, [configured, access, month, loadedMonth]);

  // Soltar el ratón fuera de la tabla también termina de pintar.
  useEffect(() => {
    const soltar = () => guardar.current();
    window.addEventListener("mouseup", soltar);
    return () => window.removeEventListener("mouseup", soltar);
  }, []);

  async function load(target: string) {
    const supabase = createClient();
    const desde = `${target}-01`;
    const hasta = new Date(Date.UTC(Number(target.slice(0, 4)), Number(target.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const [dep, mem, tpl, exc, fes, not_] = await Promise.all([
      supabase.from("staff_departments").select("id, name, sort_order").order("sort_order"),
      supabase.from("staff_members").select("id, department_id, display_name, sort_order, is_active").eq("is_active", true).order("sort_order"),
      supabase.from("staff_shift_templates").select("member_id, weekday, morning_start, morning_end, afternoon_start, afternoon_end"),
      supabase.from("staff_exceptions").select("member_id, day, kind, morning_start, morning_end, afternoon_start, afternoon_end, note").gte("day", desde).lte("day", hasta),
      supabase.from("staff_holidays").select("day, name").gte("day", desde).lte("day", hasta),
      supabase.from("staff_week_notes").select("week_start, note").gte("week_start", desde).lte("week_start", hasta),
    ]);
    const fallo = dep.error ?? mem.error ?? tpl.error ?? exc.error ?? fes.error ?? not_.error;
    if (fallo) {
      const codigo = (fallo as { code?: string }).code ?? "";
      const faltan = codigo === "PGRST205" || codigo === "42P01";
      setFaltaMigracion(faltan);
      if (!faltan) setMessage(reportSafeError(fallo, "No se pudo cargar el cuadrante."));
      setLoadedMonth(target);
      return;
    }
    setFaltaMigracion(false);
    const slot = (a: string | null, b: string | null) => (a && b ? { start: a, end: b } : null);
    const shiftOf = (r: Record<string, string | null>): DayShift => ({ morning: slot(r.morning_start, r.morning_end), afternoon: slot(r.afternoon_start, r.afternoon_end) });
    setDepartments((dep.data ?? []) as Department[]);
    setMembers((mem.data ?? []) as Member[]);
    setTemplates((tpl.data ?? []).map((r) => ({ memberId: r.member_id as string, weekday: Number(r.weekday), shift: shiftOf(r as never) })));
    setExceptions((exc.data ?? []).map((r) => ({ memberId: r.member_id as string, day: String(r.day), kind: r.kind as ExceptionKind, shift: shiftOf(r as never), note: (r.note as string | null) ?? null })));
    setHolidays((fes.data ?? []).map((r) => ({ day: String(r.day), name: String(r.name) })));
    setNotes((not_.data ?? []) as WeekNote[]);
    setLoadedMonth(target);
  }

  const ordenados = useMemo(() => {
    const pos = new Map(departments.map((d) => [d.id, d.sort_order]));
    return [...members].sort((a, b) =>
      (pos.get(a.department_id) ?? 0) - (pos.get(b.department_id) ?? 0)
      || a.sort_order - b.sort_order
      || a.display_name.localeCompare(b.display_name));
  }, [members, departments]);

  /* El filtro es solo para mirar: el PDF y los totales siguen siendo de toda
     la plantilla, que es el documento que se cuelga en la pared. */
  const visibles = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    return ordenados.filter((m) =>
      (filtroDepartamento === "all" || m.department_id === filtroDepartamento)
      && (texto === "" || m.display_name.toLowerCase().includes(texto)));
  }, [ordenados, filtroDepartamento, busqueda]);

  const filas = useMemo(
    () => buildWeek({ days: dias, memberIds: ordenados.map((m) => m.id), templates, exceptions, holidays }),
    [dias, ordenados, templates, exceptions, holidays],
  );
  const filaDe = useMemo(() => new Map(filas.map((f) => [f.memberId, f])), [filas]);

  /** Las semanas del mes, para la cabecera con sus días debajo. */
  const semanas = useMemo(() => {
    const grupos: { numero: number; dias: string[] }[] = [];
    for (const day of dias) {
      const n = weekNumber(day);
      const ultimo = grupos[grupos.length - 1];
      if (ultimo && ultimo.numero === n) ultimo.dias.push(day);
      else grupos.push({ numero: n, dias: [day] });
    }
    return grupos;
  }, [dias]);

  // ---------- Pintar ----------

  function pintar(memberId: string, day: string) {
    if (!canEdit || holidays.some((h) => h.day === day)) return;
    acumulado.current.add(`${memberId}|${day}`);
    setPintadas(new Set(acumulado.current));
  }

  function empezarPintada(memberId: string, day: string) {
    if (!canEdit) return;
    pintando.current = true;
    acumulado.current = new Set();
    pintar(memberId, day);
  }

  async function terminarPintada() {
    if (!pintando.current) return;
    pintando.current = false;
    const celdas = [...acumulado.current];
    acumulado.current = new Set();
    setPintadas(new Set());
    if (celdas.length === 0) return;
    const previas = exceptions.filter((e) => celdas.includes(`${e.memberId}|${e.day}`));
    setBusy(true);
    try {
      const supabase = createClient();
      const partes = celdas.map((c) => c.split("|"));
      if (pincel === "habitual") {
        for (const [memberId, day] of partes) {
          const { error } = await supabase.from("staff_exceptions").delete().eq("member_id", memberId).eq("day", day);
          if (error) throw error;
        }
      } else {
        const conHoras = pincel === "horario" || pincel === "tarde_libre";
        const { error } = await supabase.from("staff_exceptions").upsert(partes.map(([memberId, day]) => ({
          member_id: memberId,
          day,
          kind: pincel,
          morning_start: conHoras && horas.m1 && horas.m2 ? horas.m1 : null,
          morning_end: conHoras && horas.m1 && horas.m2 ? horas.m2 : null,
          afternoon_start: pincel === "horario" && horas.t1 && horas.t2 ? horas.t1 : null,
          afternoon_end: pincel === "horario" && horas.t1 && horas.t2 ? horas.t2 : null,
          updated_at: new Date().toISOString(),
        })), { onConflict: "member_id,day" });
        if (error) throw error;
      }
      await load(month);
      setDeshacer({ celdas, previas });
      setMessage(celdas.length === 1 ? "Día marcado." : `${celdas.length} días marcados.`);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo guardar lo marcado."));
    } finally {
      setBusy(false);
    }
  }
  guardar.current = () => void terminarPintada();

  /** Vuelve a dejar los días de la última pintada como estaban. */
  async function volverAtras() {
    if (!deshacer) return;
    setBusy(true);
    try {
      const supabase = createClient();
      for (const celda of deshacer.celdas) {
        const [memberId, day] = celda.split("|");
        const { error } = await supabase.from("staff_exceptions").delete().eq("member_id", memberId).eq("day", day);
        if (error) throw error;
      }
      if (deshacer.previas.length) {
        const { error } = await supabase.from("staff_exceptions").insert(deshacer.previas.map((e) => ({
          member_id: e.memberId,
          day: e.day,
          kind: e.kind,
          morning_start: e.shift?.morning?.start ?? null,
          morning_end: e.shift?.morning?.end ?? null,
          afternoon_start: e.shift?.afternoon?.start ?? null,
          afternoon_end: e.shift?.afternoon?.end ?? null,
          note: e.note ?? null,
        })));
        if (error) throw error;
      }
      setDeshacer(null);
      await load(month);
      setMessage("Cambio deshecho.");
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo deshacer."));
    } finally {
      setBusy(false);
    }
  }

  async function toggleFestivo(day: string) {
    if (!canEdit) return;
    setBusy(true);
    try {
      const supabase = createClient();
      const existe = holidays.some((h) => h.day === day);
      const { error } = existe
        ? await supabase.from("staff_holidays").delete().eq("day", day)
        : await supabase.from("staff_holidays").insert({ day, name: "FESTIVO" });
      if (error) throw error;
      await load(month);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo cambiar el festivo."));
    } finally {
      setBusy(false);
    }
  }

  async function saveNote(semana: string, note: string) {
    try {
      const supabase = createClient();
      const { error } = note.trim()
        ? await supabase.from("staff_week_notes").upsert({ week_start: semana, note: note.trim(), updated_at: new Date().toISOString() }, { onConflict: "week_start" })
        : await supabase.from("staff_week_notes").delete().eq("week_start", semana);
      if (error) throw error;
      await load(month);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo guardar el aviso."));
    }
  }

  // ---------- Personal ----------

  async function anadirPersona() {
    if (!nuevo.nombre.trim() || !nuevo.departamento) { setMessage("Pon el nombre y el departamento."); return; }
    setBusy(true);
    try {
      const hermanos = members.filter((m) => m.department_id === nuevo.departamento);
      const { error } = await createClient().from("staff_members").insert({
        department_id: nuevo.departamento,
        display_name: nuevo.nombre.trim().toUpperCase(),
        sort_order: Math.max(0, ...hermanos.map((h) => h.sort_order)) + 1,
      });
      if (error) throw error;
      setNuevo({ nombre: "", departamento: nuevo.departamento });
      await load(month);
      setMessage("Persona añadida. Márcale su turno pintando sobre el cuadrante.");
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo añadir."));
    } finally {
      setBusy(false);
    }
  }

  async function quitarPersona() {
    if (!borrando) return;
    setBusy(true);
    try {
      // Se desactiva en vez de borrarse: los meses pasados tienen que seguir
      // contando lo que ocurrió de verdad.
      const { error } = await createClient().from("staff_members").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", borrando.id);
      if (error) throw error;
      setBorrando(null);
      await load(month);
      setMessage("Persona quitada del cuadrante.");
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo quitar."));
    } finally {
      setBusy(false);
    }
  }

  // ---------- PDF ----------

  async function exportPdf() {
    setPdfBusy(true);
    try {
      const lunes = [...new Set(dias.map(weekStartOf))];
      await exportSchedulePdf({
        monthLabel: `${MESES[Number(month.slice(5, 7)) - 1].toUpperCase()} ${month.slice(0, 4)}`,
        filename: `horario_${month}.pdf`,
        weeks: lunes.map((semana) => {
          const diasSemana = weekDays(semana);
          const hechas = buildWeek({ days: diasSemana, memberIds: ordenados.map((m) => m.id), templates, exceptions, holidays });
          const porId = new Map(hechas.map((f) => [f.memberId, f]));
          const ultimo = diasSemana[diasSemana.length - 1];
          return {
            number: weekNumber(semana),
            range: `DEL ${semana.slice(8, 10)} AL ${ultimo.slice(8, 10)} DE ${MESES[Number(ultimo.slice(5, 7)) - 1].toUpperCase()}`,
            note: notes.find((n) => n.week_start === semana)?.note ?? "",
            days: diasSemana,
            rows: ordenados.map((m) => {
              const fila = porId.get(m.id)!;
              return {
                department: departments.find((d) => d.id === m.department_id)?.name ?? "",
                person: m.display_name,
                cells: diasSemana.map((d) => fila.cells[d]),
                tardeLibre: fila.tardeLibreDay ? weekdayName(fila.tardeLibreDay).toUpperCase() : "",
              };
            }),
          };
        }),
      });
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo generar el PDF."));
    } finally {
      setPdfBusy(false);
    }
  }

  if (access === "checking" || loading) return <PageLoader />;
  if (access === "denied") {
    return (
      <div className="page-stack">
        <section className="panel panel-padded">
          <h2>No tienes permiso para ver esta página</h2>
          <p>El cuadrante de horarios no está disponible para tu rol.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div>
          <span className="eyebrow">Administración</span>
          <h2>Horarios</h2>
          <p>El turno de siempre de cada persona y, encima, lo que cambia: festivos, vacaciones, bajas y tardes libres.</p>
        </div>
        <div className="panel-heading-trailing">
          {canEdit ? <button type="button" className="button button-secondary" onClick={() => setPersonalOpen(true)}>Personal</button> : null}
          <button type="button" className="button button-primary" disabled={pdfBusy || members.length === 0} onClick={() => void exportPdf()}>
            {pdfBusy ? "Generando…" : "Exportar PDF"}
          </button>
        </div>
      </section>

      <Toast message={message} onDismiss={() => setMessage(null)} />

      {faltaMigracion ? (
        <section className="panel panel-padded">
          <h3>Falta aplicar la migración del cuadrante</h3>
          <p className="muted">Las tablas de horarios todavía no existen. Ejecuta <strong>202610050001_horarios.sql</strong> y esta pestaña empieza a funcionar.</p>
        </section>
      ) : (
        <>
          <section className="panel panel-padded horario-barra">
            <div className="horario-filtros">
              <label><span>Mes</span><MonthField value={month} onChange={(value) => setMonth(value || todayMonth())} /></label>
              <label><span>Departamento</span>
                <select value={filtroDepartamento} onChange={(e) => setFiltroDepartamento(e.target.value)}>
                  <option value="all">Todos</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <label><span>Buscar persona</span>
                <input value={busqueda} placeholder="Nombre" onChange={(e) => setBusqueda(e.target.value)} />
              </label>
              {busqueda || filtroDepartamento !== "all" ? (
                <button type="button" className="button button-compact button-secondary" onClick={() => { setBusqueda(""); setFiltroDepartamento("all"); }}>
                  Ver a todos
                </button>
              ) : null}
              {canEdit && deshacer ? (
                <button type="button" className="button button-compact button-secondary horario-deshacer" disabled={busy} onClick={() => void volverAtras()}>
                  ↩ Deshacer {deshacer.celdas.length === 1 ? "el último cambio" : `los últimos ${deshacer.celdas.length} días`}
                </button>
              ) : null}
            </div>
            {canEdit ? (
              <div className="horario-pinceles">
                <span>Marcar pintando</span>
                <div className="role-chip-group">
                  {PINCELES.map((p) => (
                    <button key={p.kind} type="button" aria-pressed={pincel === p.kind} className={pincel === p.kind ? `role-chip active ${p.clase}` : `role-chip ${p.clase}`} onClick={() => setPincel(p.kind)}>
                      {p.label}
                    </button>
                  ))}
                </div>
                {pincel === "horario" || pincel === "tarde_libre" ? (
                  <div className="horario-horas">
                    <label><small>Mañana</small><input type="time" value={horas.m1} onChange={(e) => setHoras((h) => ({ ...h, m1: e.target.value }))} /></label>
                    <label><small>a</small><input type="time" value={horas.m2} onChange={(e) => setHoras((h) => ({ ...h, m2: e.target.value }))} /></label>
                    {pincel === "horario" ? (
                      <>
                        <label><small>Tarde</small><input type="time" value={horas.t1} onChange={(e) => setHoras((h) => ({ ...h, t1: e.target.value }))} /></label>
                        <label><small>a</small><input type="time" value={horas.t2} onChange={(e) => setHoras((h) => ({ ...h, t2: e.target.value }))} /></label>
                      </>
                    ) : null}
                  </div>
                ) : null}
                <small className="muted">Pulsa una celda, o arrastra para varias. Se guarda al soltar. El número del día marca o quita el festivo.</small>
              </div>
            ) : null}
          </section>

          {members.length === 0 ? (
            <section className="panel panel-padded">
              <h3>Todavía no hay nadie en el cuadrante</h3>
              <p className="muted">Añade personas desde el botón «Personal» y márcales su turno pintando sobre las celdas.</p>
            </section>
          ) : (
            <section className="panel table-panel horario-panel">
              <div className="table-scroll">
                <table className="horario-mes-tabla">
                  <thead>
                    <tr>
                      <th className="horario-esquina" rowSpan={2}>Persona / departamento</th>
                      {semanas.map((s) => (
                        <th key={s.numero} className="horario-semana-cabecera" colSpan={s.dias.length}>
                          <span>Semana {s.numero}</span>
                          {canEdit ? (
                            <input
                              className="horario-aviso-mini"
                              defaultValue={notes.find((n) => n.week_start === weekStartOf(s.dias[0]))?.note ?? ""}
                              placeholder="aviso de la semana…"
                              onBlur={(event) => void saveNote(weekStartOf(s.dias[0]), event.target.value)}
                            />
                          ) : null}
                        </th>
                      ))}
                      <th className="horario-total-cabecera" rowSpan={2}>Horas</th>
                    </tr>
                    <tr>
                      {dias.map((day) => {
                        const festivo = holidays.some((h) => h.day === day);
                        return (
                          <th key={day} className={festivo ? "horario-dia is-festivo" : "horario-dia"}>
                            {canEdit ? (
                              <button type="button" disabled={busy} onClick={() => void toggleFestivo(day)} title={festivo ? "Quitar festivo" : "Marcar festivo"}>
                                <span className="dnum">{day.slice(8, 10)}</span>
                                <span className="dlet">{weekdayInitial(day)}</span>
                              </button>
                            ) : (
                              <><span className="dnum">{day.slice(8, 10)}</span><span className="dlet">{weekdayInitial(day)}</span></>
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {visibles.map((member, index) => {
                      const fila = filaDe.get(member.id);
                      const departamento = departments.find((d) => d.id === member.department_id);
                      const nuevoGrupo = index === 0 || visibles[index - 1].department_id !== member.department_id;
                      return (
                        <tr key={member.id} className={nuevoGrupo ? "horario-grupo" : undefined}>
                          <th scope="row" className="horario-nombre">
                            {member.display_name}
                            <span className="dept">{departamento?.name ?? "—"}</span>
                          </th>
                          {dias.map((day) => {
                            const cell = fila?.cells[day] ?? { kind: "libre" as const };
                            const lineas = cellLines(cell);
                            const marcada = pintadas.has(`${member.id}|${day}`);
                            return (
                              <td
                                key={day}
                                className={marcada ? `${claseDe(cell)} is-pintando` : claseDe(cell)}
                                title={`${member.display_name} · ${day.slice(8, 10)}/${day.slice(5, 7)}: ${lineas.join(" · ") || "no trabaja"}`}
                                onMouseDown={() => empezarPintada(member.id, day)}
                                onMouseEnter={() => { if (pintando.current) pintar(member.id, day); }}
                              >
                                {lineas.map((l) => <span key={l}>{corto(l)}</span>)}
                              </td>
                            );
                          })}
                          <td className="horario-total">{fila ? fila.hours.toLocaleString("es-ES", { maximumFractionDigits: 1 }) : "0"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {visibles.length !== ordenados.length ? (
                <p className="muted horario-filtrado">
                  Se ven {visibles.length} de {ordenados.length} personas. El PDF sigue saliendo con toda la plantilla.
                </p>
              ) : null}

              <div className="horario-leyenda">
                <span><i className="hc" /> Turno de trabajo</span>
                <span><i className="hc is-tarde-libre" /> Tarde libre</span>
                <span><i className="hc is-ausencia" /> Vacaciones, baja o permiso</span>
                <span><i className="hc is-festivo" /> Festivo</span>
                <span><i className="hc is-libre" /> No trabaja</span>
              </div>
            </section>
          )}
        </>
      )}

      <Modal open={personalOpen} title="Personal del cuadrante" eyebrow="Horarios" onClose={() => setPersonalOpen(false)}>
        <div className="horario-personal">
          <div className="form-grid">
            <label><span>Nombre</span><input value={nuevo.nombre} placeholder="Como sale en el cuadrante" onChange={(e) => setNuevo((n) => ({ ...n, nombre: e.target.value }))} /></label>
            <label><span>Departamento</span>
              <select value={nuevo.departamento} onChange={(e) => setNuevo((n) => ({ ...n, departamento: e.target.value }))}>
                <option value="">Elige uno…</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          </div>
          <div className="modal-actions">
            <button type="button" className="button button-primary" disabled={busy} onClick={() => void anadirPersona()}>Añadir persona</button>
          </div>
          <div className="horario-personal-lista">
            {departments.map((d) => {
              const suyos = ordenados.filter((m) => m.department_id === d.id);
              if (suyos.length === 0) return null;
              return (
                <div key={d.id}>
                  <h4>{d.name}</h4>
                  <ul>
                    {suyos.map((m) => (
                      <li key={m.id}>
                        <span>{m.display_name}</span>
                        <button type="button" className="button button-compact button-secondary" onClick={() => setBorrando(m)}>Quitar</button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </Modal>

      <ConfirmationDialog
        open={Boolean(borrando)}
        title="¿Quitar a esta persona del cuadrante?"
        confirmLabel="Quitar"
        busy={busy}
        onCancel={() => setBorrando(null)}
        onConfirm={() => void quitarPersona()}
      >
        {borrando ? (
          <p className="muted">
            <strong>{borrando.display_name}</strong> deja de salir en el cuadrante. Los meses ya pasados se quedan como están,
            así que no se pierde lo que trabajó.
          </p>
        ) : null}
      </ConfirmationDialog>
    </div>
  );
}
