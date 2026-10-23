"use client";

import { useEffect, useRef, useState } from "react";
import { RespuestaFormateada } from "@/components/catalogos/respuesta-formateada";
import { SearchIcon } from "@/components/icons";

/*
  Preguntar por un producto.

  Pensado para un comercial delante de un cliente, con prisa y a lo mejor
  desde el móvil: se escribe lo que se busca en cristiano y se contesta con
  lo que haya en los catálogos del proveedor.

  La respuesta siempre dice de dónde sale cada dato —proveedor, catálogo y
  página— y avisa cuando una tarifa no es del año en curso. En la carpeta de
  2026 hay tarifas de 2022: lo que no se puede es dar un precio viejo con el
  mismo aplomo que uno bueno.
*/

type Mensaje = { de: "persona" | "chat"; texto: string; fuentes?: Fuente[] };
type Fuente = { proveedor: string; fichero: string; pagina: number | null; año: number | null };

/* Para arrancar, que delante de una caja vacía no se sabe qué se puede pedir. */
const EJEMPLOS = [
  "Un compresor de 8 bar y 500 litros",
  "¿Qué cuesta la referencia 4152025410?",
  "Compresor de tornillo silencioso",
];

export function CatalogosChat() {
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const final = useRef<HTMLDivElement>(null);

  useEffect(() => {
    final.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensajes, pensando]);

  async function preguntar(pregunta: string) {
    const limpia = pregunta.trim();
    if (!limpia || pensando) return;

    // Lo dicho hasta ahora, para que «¿y en 10 bar?» se entienda. Solo las
    // últimas: esto responde consultas, no mantiene una conversación larga.
    const anteriores = mensajes.slice(-4).map((m) => ({ de: m.de, texto: m.texto }));
    setMensajes((actuales) => [...actuales, { de: "persona", texto: limpia }]);
    setTexto("");
    setAviso(null);
    setPensando(true);

    try {
      const respuesta = await fetch("/api/catalogos/preguntar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pregunta: limpia, anteriores }),
      });
      const datos = await respuesta.json();
      if (!respuesta.ok) {
        setAviso(datos.error ?? "No se pudo responder.");
        return;
      }
      setMensajes((actuales) => [...actuales, { de: "chat", texto: datos.respuesta, fuentes: datos.fuentes }]);
    } catch {
      setAviso("No se pudo conectar. Mira si tienes cobertura y vuelve a intentarlo.");
    } finally {
      setPensando(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div>
          <span className="eyebrow">Catálogos de proveedor</span>
          <h2>Pregunta por un producto</h2>
          <p>
            Precios y características de los catálogos y tarifas de los proveedores. Pregunta en
            cristiano: qué buscas, qué tiene que aguantar, de qué marca. Cada respuesta dice de qué
            catálogo y qué página sale, para que puedas comprobarlo antes de pasárselo a un cliente.
          </p>
        </div>
      </section>

      <section className="panel panel-padded catalogos-chat">
        {mensajes.length === 0 ? (
          <div className="catalogos-vacio">
            <SearchIcon />
            <strong>¿Qué estás buscando?</strong>
            <span className="muted">Por ejemplo:</span>
            <div className="catalogos-ejemplos">
              {EJEMPLOS.map((e) => (
                <button key={e} type="button" className="sales-chip sales-chip-pick" onClick={() => void preguntar(e)}>
                  {e}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="catalogos-hilo">
            {mensajes.map((m, i) => (
              <article key={i} className={m.de === "persona" ? "catalogos-dicho es-mio" : "catalogos-dicho"}>
                {m.de === "chat"
                  ? <RespuestaFormateada texto={m.texto} />
                  : <div className="catalogos-texto">{m.texto}</div>}
                {m.fuentes && m.fuentes.length > 0 ? (
                  <details className="nota-plegable">
                    <summary>Dónde lo ha mirado ({m.fuentes.length})</summary>
                    <ul className="catalogos-fuentes">
                      {m.fuentes.map((f, j) => (
                        <li key={j}>
                          <strong>{f.proveedor}</strong> · {f.fichero}
                          {f.pagina ? ` · página ${f.pagina}` : ""}
                          {f.año ? <span className={f.año < new Date().getFullYear() ? "sales-down" : "muted"}> · {f.año}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </article>
            ))}
            {pensando ? <article className="catalogos-dicho catalogos-pensando">Mirando en los catálogos…</article> : null}
            <div ref={final} />
          </div>
        )}

        {aviso ? <p className="sales-section-note sales-down">{aviso}</p> : null}

        <form
          className="catalogos-escribir"
          onSubmit={(evento) => { evento.preventDefault(); void preguntar(texto); }}
        >
          <input
            value={texto}
            onChange={(evento) => setTexto(evento.target.value)}
            placeholder="Un compresor de 8 bar, la referencia 4152025410, una manguera de 20 metros…"
            aria-label="Qué producto buscas"
            disabled={pensando}
          />
          <button type="submit" className="button button-primary" disabled={pensando || !texto.trim()}>
            {pensando ? "Buscando…" : "Preguntar"}
          </button>
        </form>

        <p className="catalogos-letra-pequena">
          Responde con lo que pone en los catálogos, no con lo que sabe de los productos. Si una
          tarifa no es de este año, te lo dice. Confirma el precio antes de cerrar una venta.
        </p>
      </section>
    </div>
  );
}
