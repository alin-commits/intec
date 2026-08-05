import Link from "next/link";

export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="panel login-card">
        <span className="brand-mark">I</span>
        <h1>Intec Commercial Hub</h1>
        <p>Accede al panel interno de consultas, leads y campañas.</p>
        <form>
          <label>Email<input type="email" placeholder="nombre@empresa.com" /></label>
          <label>Contraseña<input type="password" placeholder="••••••••" /></label>
          <div className="login-actions"><button type="button" className="button button-primary">Iniciar sesión</button><Link href="/dashboard" className="button button-secondary">Entrar en la demo</Link></div>
        </form>
      </section>
    </main>
  );
}
