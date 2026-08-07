import Link from "next/link";
import { Logo } from "@/components/logo";

export default function Home() {
  return (
    <main className="landing-page">
      <div className="landing-hero">
        <Logo className="landing-logo" priority />
        <h1>Suministros Intec</h1>
        <p>Elige a dónde quieres ir.</p>
      </div>
      <div className="landing-grid">
        <Link href="/soporte" className="panel landing-card">
          <span className="eyebrow">Sin registro</span>
          <h2>Ticket informático</h2>
          <p>¿Tienes un problema técnico? Envíalo aquí, sin necesidad de cuenta.</p>
        </Link>
        <Link href="/dashboard" className="panel landing-card">
          <span className="eyebrow">Con acceso</span>
          <h2>Panel comercial</h2>
          <p>Consultas, leads, campañas y estadísticas de la empresa.</p>
        </Link>
      </div>
    </main>
  );
}
