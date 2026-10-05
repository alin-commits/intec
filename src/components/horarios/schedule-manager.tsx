"use client";

import { useEffect, useMemo, useState } from "react";
import { MonthField } from "@/components/ui/date-field";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";
import { PageLoader } from "@/components/ui/page-loader";
import { SCHEDULE_EDIT_ROLES, SCHEDULE_ROLES, hasAnyRole } from "@/lib/constants";
import { reportSafeError } from "@/lib/errors";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { loadCurrentProfile } from "@/lib/supabase/current-profile";
import { exportSchedulePdf } from "@/lib/horarios/schedule-pdf";
import {
  buildWeek,
  cellLines,
  weekDays,
  weekStartOf,
  weekdayName,
  type DayCell,
  type DayShift,
  type ExceptionKind,
  type Holiday,
  type ScheduleException,
  type ShiftTemplate,
} from "@/lib/horarios/model";

/*
  El cuadrante de horarios, semana a semana.

  Lo que se ve es el mismo papel de siempre: departamentos a la izquierda, de
  lunes a viernes, mañana arriba y tarde abajo. Lo que cambia es que debajo no
  hay 500 celdas escritas a mano, sino el turno habitual de cada persona y las
  cuatro cosas que se salen de él esa semana.
*/

type Department = { id: string; name: string; sort_order: number };
type Member = { id: string; department_id: string; display_name: string; sort_order: number; is_active: boolean };
type WeekNote = { week_start: string; note: string };

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS_CABECERA = ["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES"];

const monthKeyOf = (day: string) => day.slice(0, 7);
const todayMonth = () => new Date().toISOString().slice(0, 7);

/** Las semanas (su lunes) que tocan algún día de ese mes, de lunes a viernes. */
export function weeksOfMonth(monthKey: string): string[] {
  const [year, month] = monthKey.split("-").map(Number);
  const semanas: string[] = [];
  const cursor = new Date(Date.UTC(year, month - 1, 1));
  const fin = new Date(Date.UTC(year, month, 0));
  let lunes = weekStartOf(cursor.toISOString().slice(0, 10));
  while (lunes <= fin.toISOString().slice(0, 10)) {
    // Una semana cuenta si alguno de sus días laborables cae dentro del mes.
    if (weekDays(lunes).some((d) => monthKeyOf(d) === monthKey)) semanas.push(lunes);
    const siguiente = new Date(`${lunes}T00:00:00Z`);
    siguiente.setUTCDate(siguiente.getUTCDate() + 7);
    lunes = siguiente.toISOString().slice(0, 10);
  }
  return semanas;
}

/** El número de semana del año, como lo numera el cuadrante de papel. */
export function weekNumber(day: string): number {
  const d = new Date(`${day}T00:00:00Z`);
  const jueves = new Date(d);
  jueves.setUTCDate(d.getUTCDate() + 3);
  const primero = new Date(Date.UTC(jueves.getUTCFullYear(), 0, 1));
  return Math.ceil(((jueves.getTime() - primero.getTime()) / 86400000 + 1) / 7);
}

const dayLabel = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
export function rangeLabel(weekStart: string): string {
  const dias = weekDays(weekStart);
  const ultimo = dias[dias.length - 1];
  return `DEL ${dias[0].slice(8, 10)} AL ${ultimo.slice(8, 10)} DE ${MESES[Number(ultimo.slice(5, 7)) - 1].toUpperCase()}`;
}

const TIPOS: { kind: ExceptionKind; label: string }[] = [
  { kind: "vacaciones", label: "Vacaciones" },
  { kind: "baja", label: "Baja" },
  { kind: "permiso", label: "Permiso" },
  { kind: "tarde_libre", label: "Tarde libre" },
  { kind: "horario", label: "Otro horario" },
  { kind: "no_trabaja", label: "No trabaja" },
];

const cellClass = (cell: DayCell) => {
  if (cell.kind === "festivo") return "horario-celda is-festivo";
  if (cell.kind === "ausencia") return "horario-celda is-ausencia";
  if (cell.kind === "libre") return "horario-celda is-libre";
  return cell.tardeLibre ? "horario-celda is-tarde-libre" : "horario-celda";
};

export function ScheduleManager() {
  const configured = isSupabaseConfigured();
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">(configured ? "checking" : "allowed");
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(configured);
  const [message, setMessage] = useState<string | null>(null);

  const [month, setMonth] = useState(todayMonth);
  const [weekStart, setWeekStart] = useState(() => weeksOfMonth(todayMonth())[0] ?? weekStartOf(new Date().toISOString().slice(0, 10)));

  const [departments, setDepartments] = useState<Department[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [exceptions, setExceptions] = useState<ScheduleException[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [notes, setNotes] = useState<WeekNote[]>([]);

  const [editing, setEditing] = useState<{ member: Member; day: string; current: DayCell } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  /** true mientras no se hayan aplicado las migraciones del cuadrante. */
  const [faltaMigracion, setFaltaMigracion] = useState(false);

  const semanas = useMemo(() => weeksOfMonth(month), [month]);
  const dias = useMemo(() => weekDays(weekStart), [weekStart]);

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
    // La carga de cada mes se pide aparte, más abajo.
  }, [configured]);

  // Al cambiar de mes se recoloca la semana y se traen sus excepciones.
  const [loadedMonth, setLoadedMonth] = useState<string | null>(null);
  useEffect(() => {
    if (!configured || access !== "allowed" || loadedMonth === month) return;
    void load(month);
  }, [configured, access, month, loadedMonth]);

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
      // Entre que se despliega el código y se ejecuta la migración pasan
      // minutos, y "no se pudo cargar" suena a roto cuando lo que falta es un
      // paso. Si las tablas no están todavía, se dice.
      const codigo = (fallo as { code?: string }).code ?? "";
      setFaltaMigracion(codigo === "PGRST205" || codigo === "42P01");
      if (codigo !== "PGRST205" && codigo !== "42P01") setMessage(reportSafeError(fallo, "No se pudo cargar el cuadrante."));
      return;
    }
    setFaltaMigracion(false);

    const slot = (a: string | null, b: string | null) => (a && b ? { start: a, end: b } : null);
    const shiftOf = (r: Record<string, string | null>): DayShift => ({
      morning: slot(r.morning_start, r.morning_end),
      afternoon: slot(r.afternoon_start, r.afternoon_end),
    });
    setDepartments((dep.data ?? []) as Department[]);
    setMembers((mem.data ?? []) as Member[]);
    setTemplates((tpl.data ?? []).map((r) => ({ memberId: r.member_id as string, weekday: Number(r.weekday), shift: shiftOf(r as never) })));
    setExceptions((exc.data ?? []).map((r) => ({ memberId: r.member_id as string, day: String(r.day), kind: r.kind as ExceptionKind, shift: shiftOf(r as never), note: (r.note as string | null) ?? null })));
    setHolidays((fes.data ?? []).map((r) => ({ day: String(r.day), name: String(r.name) })));
    setNotes((not_.data ?? []) as WeekNote[]);
    setLoadedMonth(target);
    if (!weeksOfMonth(target).includes(weekStart)) setWeekStart(weeksOfMonth(target)[0] ?? weekStart);
  }

  const ordered = useMemo(() => {
    const porDepartamento = new Map(departments.map((d) => [d.id, d]));
    return [...members].sort((a, b) => {
      const da = porDepartamento.get(a.department_id)?.sort_order ?? 0;
      const db = porDepartamento.get(b.department_id)?.sort_order ?? 0;
      return da - db || a.sort_order - b.sort_order || a.display_name.localeCompare(b.display_name);
    });
  }, [members, departments]);

  const rows = useMemo(
    () => buildWeek({ days: dias, memberIds: ordered.map((m) => m.id), templates, exceptions, holidays }),
    [dias, ordered, templates, exceptions, holidays],
  );
  const rowOf = useMemo(() => new Map(rows.map((r) => [r.memberId, r])), [rows]);
  const noteOf = (semana: string) => notes.find((n) => n.week_start === semana)?.note ?? "";

  async function saveException(kind: ExceptionKind | null, shift?: DayShift) {
    if (!editing) return;
    setBusy(true);
    try {
      const supabase = createClient();
      if (kind === null) {
        const { error } = await supabase.from("staff_exceptions").delete().eq("member_id", editing.member.id).eq("day", editing.day);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("staff_exceptions").upsert({
          member_id: editing.member.id,
          day: editing.day,
          kind,
          morning_start: shift?.morning?.start ?? null,
          morning_end: shift?.morning?.end ?? null,
          afternoon_start: shift?.afternoon?.start ?? null,
          afternoon_end: shift?.afternoon?.end ?? null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "member_id,day" });
        if (error) throw error;
      }
      await load(month);
      setEditing(null);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo guardar el cambio."));
    } finally {
      setBusy(false);
    }
  }

  async function toggleHoliday(day: string) {
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

  async function exportPdf() {
    setPdfBusy(true);
    try {
      await exportSchedulePdf({
        monthLabel: `${MESES[Number(month.slice(5, 7)) - 1].toUpperCase()} ${month.slice(0, 4)}`,
        filename: `horario_${month}.pdf`,
        weeks: semanas.map((semana) => {
          const dias = weekDays(semana);
          const filas = buildWeek({ days: dias, memberIds: ordered.map((m) => m.id), templates, exceptions, holidays });
          const porId = new Map(filas.map((f) => [f.memberId, f]));
          return {
            number: weekNumber(semana),
            range: rangeLabel(semana),
            note: noteOf(semana),
            days: dias,
            rows: ordered.map((m) => {
              const fila = porId.get(m.id)!;
              return {
                department: departments.find((d) => d.id === m.department_id)?.name ?? "",
                person: m.display_name,
                cells: dias.map((d) => fila.cells[d]),
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

  const sinPlantilla = members.length === 0;

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div>
          <span className="eyebrow">Administración</span>
          <h2>Horarios</h2>
          <p>El turno de siempre de cada persona, y encima lo que cambia esta semana: festivos, vacaciones, bajas y tardes libres.</p>
        </div>
        <div className="panel-heading-trailing">
          <button type="button" className="button button-secondary" disabled={pdfBusy || sinPlantilla} onClick={() => void exportPdf()}>
            {pdfBusy ? "Generando…" : "Exportar PDF del mes"}
          </button>
        </div>
      </section>

      <Toast message={message} onDismiss={() => setMessage(null)} />

      <section className="panel panel-padded horario-controles">
        <label><span>Mes</span><MonthField value={month} onChange={(value) => setMonth(value || todayMonth())} /></label>
        <div className="horario-semanas" role="tablist" aria-label="Semanas del mes">
          {semanas.map((semana) => (
            <button
              key={semana}
              type="button"
              role="tab"
              aria-selected={semana === weekStart}
              className={semana === weekStart ? "view-tab active" : "view-tab"}
              onClick={() => setWeekStart(semana)}
            >
              Semana {weekNumber(semana)}
            </button>
          ))}
        </div>
      </section>

      {faltaMigracion ? (
        <section className="panel panel-padded">
          <h3>Falta aplicar la migración del cuadrante</h3>
          <p className="muted">
            Las tablas de horarios todavía no existen en la base de datos. En cuanto se ejecute
            <strong> 202610050001_horarios.sql</strong>, esta pestaña empieza a funcionar.
          </p>
        </section>
      ) : sinPlantilla ? (
        <section className="panel panel-padded">
          <h3>Todavía no hay nadie en el cuadrante</h3>
          <p className="muted">En cuanto se cargue la plantilla y su turno habitual, aquí sale el cuadrante de cada semana.</p>
        </section>
      ) : (
        <section className="panel table-panel horario-panel">
          <div className="panel-heading horario-cabecera">
            <div>
              <h3>Semana {weekNumber(weekStart)}</h3>
              <p className="panel-subtitle">{rangeLabel(weekStart)}</p>
            </div>
            {canEdit ? (
              <input
                className="horario-aviso"
                defaultValue={noteOf(weekStart)}
                placeholder="Aviso de la semana (por ejemplo: NO SE LIBRA POR FESTIVO 09/10)"
                onBlur={(event) => void saveNote(weekStart, event.target.value)}
              />
            ) : noteOf(weekStart) ? <strong className="horario-aviso-texto">{noteOf(weekStart)}</strong> : null}
          </div>

          <div className="table-scroll">
            <table className="horario-tabla">
              <thead>
                <tr>
                  <th>Departamento</th>
                  <th>Persona</th>
                  {dias.map((day, i) => (
                    <th key={day}>
                      {DIAS_CABECERA[i]}
                      <small>{dayLabel(day)}</small>
                      {canEdit ? (
                        <button type="button" className="horario-festivo-toggle" disabled={busy} onClick={() => void toggleHoliday(day)}>
                          {holidays.some((h) => h.day === day) ? "quitar festivo" : "marcar festivo"}
                        </button>
                      ) : null}
                    </th>
                  ))}
                  <th>Tarde libre</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((member, index) => {
                  const fila = rowOf.get(member.id);
                  const departamento = departments.find((d) => d.id === member.department_id);
                  const primeroDelGrupo = index === 0 || ordered[index - 1].department_id !== member.department_id;
                  const cuantos = ordered.filter((m) => m.department_id === member.department_id).length;
                  return (
                    <tr key={member.id}>
                      {primeroDelGrupo ? <th scope="rowgroup" rowSpan={cuantos} className="horario-departamento">{departamento?.name ?? "—"}</th> : null}
                      <td className="horario-persona">{member.display_name}</td>
                      {dias.map((day) => {
                        const cell = fila?.cells[day] ?? { kind: "libre" as const };
                        const lineas = cellLines(cell);
                        return (
                          <td key={day} className={cellClass(cell)}>
                            {canEdit ? (
                              <button type="button" className="horario-celda-boton" onClick={() => setEditing({ member, day, current: cell })}>
                                {lineas.length ? lineas.map((l) => <span key={l}>{l}</span>) : <span className="muted">—</span>}
                              </button>
                            ) : (
                              lineas.length ? lineas.map((l) => <span key={l}>{l}</span>) : <span className="muted">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="horario-tarde-libre">{fila?.tardeLibreDay ? weekdayName(fila.tardeLibreDay).toUpperCase() : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Modal open={Boolean(editing)} title={editing ? `${editing.member.display_name} · ${dayLabel(editing.day)}` : ""} eyebrow="Cambiar el día" onClose={() => setEditing(null)}>
        {editing ? (
          <div className="horario-editor">
            <p className="muted">
              Hoy pone: <strong>{cellLines(editing.current).join(" · ") || "no trabaja"}</strong>.
              {editing.current.kind === "festivo" ? " Es festivo de toda la casa, así que manda sobre lo que pongas aquí." : ""}
            </p>
            <div className="role-chip-group">
              {TIPOS.map((tipo) => (
                <button key={tipo.kind} type="button" className="role-chip" disabled={busy} onClick={() => void saveException(tipo.kind)}>
                  {tipo.label}
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setEditing(null)}>Cerrar</button>
              <button type="button" className="button button-primary" disabled={busy} onClick={() => void saveException(null)}>
                Volver a su turno de siempre
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
