import { Logo } from "@/components/logo";
import { InvitationForm } from "@/components/invitation-form";

export default function InvitationPage() {
  return (
    <main className="login-page">
      <section className="panel login-card">
        <Logo className="login-logo" priority />
        <h1>Activa tu cuenta</h1>
        <p>Elige una contraseña para acceder al panel.</p>
        <InvitationForm />
      </section>
    </main>
  );
}
