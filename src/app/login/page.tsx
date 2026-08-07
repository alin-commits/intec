import { Logo } from "@/components/logo";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="panel login-card">
        <Logo className="login-logo" priority />
        <h1>Commercial Hub</h1>
        <p>Accede al panel interno de consultas, leads y campañas.</p>
        <LoginForm />
      </section>
    </main>
  );
}
