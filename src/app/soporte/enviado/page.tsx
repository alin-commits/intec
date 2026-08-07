import Link from "next/link";
import { Logo } from "@/components/logo";

type SoporteEnviadoPageProps = {
  searchParams: Promise<{ ticket?: string }>;
};

export default async function SoporteEnviadoPage({ searchParams }: SoporteEnviadoPageProps) {
  const { ticket } = await searchParams;

  return (
    <main className="support-page">
      <div className="support-shell support-shell-narrow">
        <Logo className="support-logo" priority />
        <section className="panel support-confirmation">
          <span className="eyebrow">Incidencia recibida</span>
          <h1>Gracias, hemos recibido tu incidencia</h1>
          {ticket ? <p className="support-ticket-number">{ticket}</p> : null}
          <p>Nos pondremos en contacto contigo por WhatsApp, teléfono o presencialmente para resolverla.</p>
          <div className="login-actions">
            <Link href="/soporte" className="button button-secondary">Enviar otra incidencia</Link>
            <Link href="/" className="button button-secondary">Volver al inicio</Link>
          </div>
        </section>
      </div>
    </main>
  );
}
