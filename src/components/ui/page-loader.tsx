/*
  Lo que se ve mientras una página comprueba quién entra y trae sus datos: un
  giro pequeño y qué se está cargando. Antes esas páginas se quedaban en blanco,
  y en las lentas (el gestor de contraseñas) parecía que no respondían.

  Aparece con un poco de retraso (lo pone el CSS): si la carga es rápida no se
  llega a ver y la página no parpadea.
*/

/** El giro, para dentro de un botón o de una línea de texto. */
export function Spinner({ label }: { label?: string }) {
  return <span className="spinner" role={label ? "status" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

/**
 * Cuando la primera carga de una página falla. Antes la página se quedaba
 * girando para siempre y el aviso del error no llegaba a verse.
 */
export function PageLoadFailed({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <div className="page-stack">
      <section className="panel panel-padded" role="alert">
        <h2>No se pudo cargar esta página</h2>
        <p>{message ?? "Ha fallado la conexión con la base de datos."} Si vuelve a pasar, avisa a administración.</p>
        <button type="button" className="button button-primary" onClick={onRetry}>Reintentar</button>
      </section>
    </div>
  );
}

export function PageLoader({ label = "Cargando…" }: { label?: string }) {
  return (
    <div className="page-stack">
      <div className="page-loader" role="status" aria-live="polite">
        <span className="spinner spinner-large" aria-hidden="true" />
        <span>{label}</span>
      </div>
    </div>
  );
}
