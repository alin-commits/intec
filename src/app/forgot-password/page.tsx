import { Logo } from "@/components/logo";
import { ForgotPasswordForm } from "@/components/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="login-page">
      <section className="panel login-card">
        <Logo className="login-logo" priority />
        <h1>Recuperar contraseña</h1>
        <p>Introduce tu email y te enviaremos un enlace para restablecerla.</p>
        <ForgotPasswordForm />
      </section>
    </main>
  );
}
