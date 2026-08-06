import Link from "next/link";
import { Logo } from "@/components/logo";
import { TicketForm } from "@/components/tickets/ticket-form";

export default function SoportePage() {
  return (
    <main className="support-page">
      <div className="support-shell">
        <div className="support-header">
          <Logo className="support-logo" priority />
          <div>
            <span className="eyebrow">Soporte informático</span>
            <h1>Enviar una incidencia</h1>
            <p>Cuéntanos qué problema tienes. No necesitas cuenta ni contraseña — el seguimiento se hará por WhatsApp, teléfono o presencialmente.</p>
          </div>
        </div>
        <section className="panel support-panel">
          <TicketForm />
        </section>
        <Link href="/" className="support-back-link">← Volver al inicio</Link>
      </div>
    </main>
  );
}
