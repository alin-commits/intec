"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CalendarIcon } from "@/components/icons";
import { dateKeyInMadrid, monthKey, monthLabel } from "@/lib/dates";
import { formatDate } from "@/lib/format";

/**
 * El selector de fechas de toda la aplicación.
 *
 * Los `<input type="date">` del navegador se ven distintos en cada uno: Chrome
 * pinta su icono gris, Firefox otro, Safari ninguno, y el calendario que abren
 * no se parece en nada al resto de la web. Esto es el mismo campo con el
 * calendario dibujado por nosotros.
 *
 * El valor que entra y sale es el mismo que usaba el input nativo —"YYYY-MM-DD"
 * para un día, "YYYY-MM" para un mes— así que quien lo usa no cambia nada más
 * que el nombre de la etiqueta.
 */

type Granularity = "day" | "month";

type DateFieldProps = {
  value: string;
  onChange: (value: string) => void;
  /** Primer valor elegible, en el mismo formato que `value`. */
  min?: string;
  /** Último valor elegible, en el mismo formato que `value`. */
  max?: string;
  readOnly?: boolean;
  required?: boolean;
  /** Texto cuando no hay nada elegido. */
  placeholder?: string;
  ariaLabel?: string;
};

const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** Cuántos años se ofrecen de golpe al saltar de año. */
const YEAR_PAGE = 12;

const pad = (value: number) => String(value).padStart(2, "0");
const todayKey = () => dateKeyInMadrid(new Date().toISOString());

/** El mes al que pertenece un valor, sea de día o de mes. */
function monthOf(value: string, granularity: Granularity): string {
  if (value) return granularity === "day" ? value.slice(0, 7) : value;
  return monthKey();
}

function shiftMonth(month: string, amount: number): string {
  const [year, index] = month.split("-").map(Number);
  const moved = new Date(Date.UTC(year, index - 1 + amount, 1));
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}`;
}

/**
 * Las seis semanas que se pintan de un mes, empezando en lunes. Se trabaja en
 * UTC a propósito: aquí solo importa el número del día del calendario, y con
 * horas locales el cambio de hora de marzo y octubre corre las casillas.
 */
function monthGrid(month: string): { key: string; day: number; inMonth: boolean }[] {
  const [year, index] = month.split("-").map(Number);
  const firstWeekday = (new Date(Date.UTC(year, index - 1, 1)).getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, offset) => {
    const date = new Date(Date.UTC(year, index - 1, 1 - firstWeekday + offset));
    return {
      key: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === index - 1 && date.getUTCFullYear() === year,
    };
  });
}

function outOfRange(candidate: string, min: string | undefined, max: string | undefined): boolean {
  // Las dos formas de valor, "YYYY-MM-DD" y "YYYY-MM", se ordenan bien como
  // texto, así que no hace falta convertirlas a fecha para compararlas.
  if (min && candidate < min) return true;
  if (max && candidate > max) return true;
  return false;
}

/** El mes entero queda fuera cuando ni su primer ni su último día entran. */
function monthOutOfRange(month: string, min: string | undefined, max: string | undefined): boolean {
  if (min && month < min.slice(0, 7)) return true;
  if (max && month > max.slice(0, 7)) return true;
  return false;
}

function DateFieldInner({ value, onChange, min, max, readOnly, required, placeholder, ariaLabel, granularity }: DateFieldProps & { granularity: Granularity }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"days" | "months" | "years">(granularity === "day" ? "days" : "months");
  const [cursorMonth, setCursorMonth] = useState(() => monthOf(value, granularity));
  const [yearPageStart, setYearPageStart] = useState(() => Number(monthOf(value, granularity).slice(0, 4)) - Math.floor(YEAR_PAGE / 2));
  const [dropUp, setDropUp] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const labelId = useId();

  // Al abrirlo se coloca donde está el valor, no donde se quedó la última vez.
  function openPicker() {
    if (readOnly) return;
    const month = monthOf(value, granularity);
    setCursorMonth(month);
    setYearPageStart(Number(month.slice(0, 4)) - Math.floor(YEAR_PAGE / 2));
    setView(granularity === "day" ? "days" : "months");
    setOpen(true);
  }

  // Cerrar al pulsar fuera o con Escape. El listener se pone solo mientras está
  // abierto: si no, toda la página escucha cada clic por cada campo de fecha.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      wrapRef.current?.querySelector<HTMLButtonElement>(".date-field-trigger")?.focus();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  // Si no cabe debajo, se abre hacia arriba. En un filtro al final de la página
  // el calendario quedaba medio fuera de la pantalla.
  useEffect(() => {
    if (!open) return;
    const trigger = wrapRef.current?.getBoundingClientRect();
    const popup = popupRef.current?.getBoundingClientRect();
    if (!trigger || !popup) return;
    setDropUp(trigger.bottom + popup.height + 12 > window.innerHeight && trigger.top > popup.height);
  }, [open, view]);

  function pick(next: string) {
    onChange(next);
    setOpen(false);
    wrapRef.current?.querySelector<HTMLButtonElement>(".date-field-trigger")?.focus();
  }

  const shown = value
    ? granularity === "day" ? formatDate(value) : monthLabel(value)
    : placeholder ?? (granularity === "day" ? "Elegir fecha" : "Elegir mes");
  const cursorYear = Number(cursorMonth.slice(0, 4));
  const today = todayKey();

  return (
    <div className="date-field" ref={wrapRef}>
      <button
        type="button"
        className={`date-field-trigger${value ? "" : " is-empty"}${open ? " is-open" : ""}`}
        onClick={() => (open ? setOpen(false) : openPicker())}
        disabled={readOnly}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <CalendarIcon />
        <span>{shown}</span>
        {required && !value ? <em aria-hidden="true">*</em> : null}
      </button>

      {open ? (
        <div
          className={`date-field-popup${dropUp ? " is-up" : ""}`}
          ref={popupRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby={labelId}
        >
          <div className="date-field-head">
            <button
              type="button"
              className="date-field-step"
              onClick={() => (view === "years" ? setYearPageStart((start) => start - YEAR_PAGE) : view === "months" ? setCursorMonth(shiftMonth(cursorMonth, -12)) : setCursorMonth(shiftMonth(cursorMonth, -1)))}
              aria-label="Anterior"
            >
              ‹
            </button>
            <button
              type="button"
              className="date-field-title"
              id={labelId}
              onClick={() => setView(view === "days" ? "months" : view === "months" ? "years" : "months")}
            >
              {view === "years"
                ? `${yearPageStart} – ${yearPageStart + YEAR_PAGE - 1}`
                : view === "months"
                  ? cursorYear
                  : monthLabel(cursorMonth)}
            </button>
            <button
              type="button"
              className="date-field-step"
              onClick={() => (view === "years" ? setYearPageStart((start) => start + YEAR_PAGE) : view === "months" ? setCursorMonth(shiftMonth(cursorMonth, 12)) : setCursorMonth(shiftMonth(cursorMonth, 1)))}
              aria-label="Siguiente"
            >
              ›
            </button>
          </div>

          {view === "days" ? (
            <>
              <div className="date-field-weekdays" aria-hidden="true">
                {WEEKDAYS.map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
              </div>
              <div className="date-field-days">
                {monthGrid(cursorMonth).map((cell) => (
                  <button
                    key={cell.key}
                    type="button"
                    className={[
                      "date-field-day",
                      cell.inMonth ? "" : "is-outside",
                      cell.key === value ? "is-selected" : "",
                      cell.key === today ? "is-today" : "",
                    ].filter(Boolean).join(" ")}
                    disabled={outOfRange(cell.key, min, max)}
                    aria-current={cell.key === today ? "date" : undefined}
                    aria-pressed={cell.key === value}
                    onClick={() => pick(cell.key)}
                  >
                    {cell.day}
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {view === "months" ? (
            <div className="date-field-months">
              {MONTHS_SHORT.map((name, index) => {
                const month = `${cursorYear}-${pad(index + 1)}`;
                return (
                  <button
                    key={month}
                    type="button"
                    className={`date-field-cell${month === monthOf(value, granularity) && value ? " is-selected" : ""}`}
                    disabled={granularity === "month" ? outOfRange(month, min, max) : monthOutOfRange(month, min, max)}
                    onClick={() => (granularity === "month" ? pick(month) : (setCursorMonth(month), setView("days")))}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          ) : null}

          {view === "years" ? (
            <div className="date-field-months">
              {Array.from({ length: YEAR_PAGE }, (_, index) => yearPageStart + index).map((year) => (
                <button
                  key={year}
                  type="button"
                  className={`date-field-cell${year === cursorYear ? " is-selected" : ""}`}
                  onClick={() => {
                    setCursorMonth(`${year}-${cursorMonth.slice(5, 7)}`);
                    setView("months");
                  }}
                >
                  {year}
                </button>
              ))}
            </div>
          ) : null}

          <div className="date-field-foot">
            <button
              type="button"
              className="date-field-shortcut"
              disabled={outOfRange(granularity === "day" ? today : monthKey(), min, max)}
              onClick={() => pick(granularity === "day" ? today : monthKey())}
            >
              {granularity === "day" ? "Hoy" : "Este mes"}
            </button>
            {value && !required ? (
              <button type="button" className="date-field-shortcut" onClick={() => pick("")}>Borrar</button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Un día concreto. El valor entra y sale como "YYYY-MM-DD". */
export function DateField(props: DateFieldProps) {
  return <DateFieldInner {...props} granularity="day" />;
}

/** Un mes entero. El valor entra y sale como "YYYY-MM". */
export function MonthField(props: DateFieldProps) {
  return <DateFieldInner {...props} granularity="month" />;
}
