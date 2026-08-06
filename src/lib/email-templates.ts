export function emailShell(title: string, bodyHtml: string, eyebrow = "Intec Commercial Hub", maxWidth = 480): string {
  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:32px 16px;background:#f5f7fb;font-family:Segoe UI,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" style="max-width:${maxWidth}px;margin:0 auto;background:#ffffff;border-radius:14px;border:1px solid #e8ebf2;overflow:hidden;">
      <tr><td style="padding:28px 32px 8px;">
        <p style="margin:0;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#1d4ed8;">${eyebrow}</p>
        <h1 style="margin:10px 0 4px;font-size:20px;">${title}</h1>
      </td></tr>
      <tr><td style="padding:8px 32px 32px;font-size:14px;line-height:1.6;color:#334155;">
        ${bodyHtml}
      </td></tr>
    </table>
  </body>
</html>`;
}

export function emailButton(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;margin-top:18px;padding:12px 22px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:9px;font-weight:600;font-size:14px;">${label}</a>`;
}

export function buildInviteEmail(fullName: string, actionLink: string): { subject: string; html: string } {
  const body = `
    <p>Hola ${fullName},</p>
    <p>Te han dado acceso al panel interno de consultas, leads y campañas de Suministros Intec.</p>
    ${emailButton(actionLink, "Activar mi cuenta")}
    <p style="margin-top:20px;font-size:12px;color:#64748b;">Si no esperabas esta invitación, puedes ignorar este correo.</p>
  `;
  return { subject: "Te han invitado a Intec Commercial Hub", html: emailShell("Activa tu cuenta", body) };
}

export function buildResetPasswordEmail(actionLink: string): { subject: string; html: string } {
  const body = `
    <p>Hemos recibido una solicitud para restablecer tu contraseña.</p>
    ${emailButton(actionLink, "Restablecer contraseña")}
    <p style="margin-top:20px;font-size:12px;color:#64748b;">Si no has solicitado este cambio, puedes ignorar este correo: tu contraseña actual seguirá funcionando.</p>
  `;
  return { subject: "Restablece tu contraseña — Intec Commercial Hub", html: emailShell("Restablecer contraseña", body) };
}
