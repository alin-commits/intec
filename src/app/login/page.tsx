import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="panel login-card">
        <span className="brand-mark">I</span>
        <h1>Intec Commercial Hub</h1>
        <p>Accede al panel interno de consultas, leads y campañas.</p>
        <LoginForm />
      </section>
    </main>
  );
}
