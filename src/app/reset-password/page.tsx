import { Logo } from "@/components/logo";
import { ResetPasswordForm } from "@/components/reset-password-form";

export default function ResetPasswordPage() {
  return (
    <main className="login-page">
      <section className="panel login-card">
        <Logo className="login-logo" priority />
        <h1>Nueva contraseña</h1>
        <p>Elige una nueva contraseña para tu cuenta.</p>
        <ResetPasswordForm />
      </section>
    </main>
  );
}
