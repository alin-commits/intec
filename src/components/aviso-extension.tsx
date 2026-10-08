"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/*
  "La página sale en blanco": casi siempre es una extensión, no la aplicación.

  Los bloqueadores de anuncios hacen dos cosas. Una es cortar peticiones; la
  otra, menos conocida, es esconder trozos de página con reglas de CSS que
  buscan huecos publicitarios por el nombre de sus clases, por la dirección o
  por el texto. El 08/10/2026 una de esas reglas dejó la pestaña de publicidad
  en blanco en producción: los datos llegaban, el contenido estaba pintado, y un
  contenedor de más arriba tenía display:none. Costó una tarde averiguarlo,
  porque la aplicación no tenía forma de decir lo que pasaba.

  Perseguir la palabra que dispara la regla no sirve: las listas de filtros se
  actualizan solas y mañana cazan otra. Lo que sí sirve es darse cuenta y
  decirlo.

  Cómo lo sabe, con dos señales que tienen que darse a la vez:

    1. Un señuelo: un elemento con las clases que esos filtros persiguen. Si
       alguien lo esconde, hay un bloqueador con reglas cosméticas activo. Esto
       solo, no basta: tener bloqueador no es ningún problema.
    2. Que la página esté de verdad vacía: el contenido principal, medido
       después de pintar, ocupa menos de lo que ocuparía cualquier pantalla con
       algo dentro.

  Las clases de este aviso son neutras a propósito: si se llamara "ad-warning"
  lo escondería la misma regla que queremos denunciar.
*/

/** Lo que mide una pantalla con algo dentro; por debajo, está vacía. */
const ALTO_SOSPECHOSO = 220;
/** Tiempo para que los datos lleguen y la página termine de pintarse. */
const ESPERA_MS = 2500;

export function AvisoExtension() {
  const pathname = usePathname();
  // Se guarda en qué pantalla se detectó, no un simple sí/no: así al cambiar de
  // página el aviso desaparece solo, sin tener que reiniciarlo al entrar en el
  // efecto (que es justo lo que React 19 no deja hacer).
  const [rutaOculta, setRutaOculta] = useState<string | null>(null);
  const [cerrado, setCerrado] = useState<string | null>(null);

  useEffect(() => {
    const temporizador = window.setTimeout(() => {
      // 1. El señuelo, con las clases que buscan los filtros.
      const senuelo = document.createElement("div");
      senuelo.className = "ad-banner ads adsbox sponsored";
      senuelo.style.cssText = "position:absolute;left:-9999px;top:-9999px;width:300px;height:120px;pointer-events:none";
      document.body.appendChild(senuelo);
      const estilo = window.getComputedStyle(senuelo);
      const hayBloqueador = estilo.display === "none" || senuelo.offsetHeight === 0 || estilo.visibility === "hidden";
      senuelo.remove();
      if (!hayBloqueador) return;

      // 2. Y que además esta pantalla haya quedado vacía. No sirve medir <main>:
      // ocupa toda la ventana aunque no tenga nada dentro. Se suma lo que miden
      // sus hijos, sin contar la barra de arriba ni este mismo aviso.
      const contenido = document.querySelector("main");
      if (!contenido) return;
      const alto = [...contenido.children]
        .filter((hijo) => !hijo.classList.contains("topbar") && !hijo.classList.contains("aviso-navegador"))
        .reduce((total, hijo) => total + hijo.getBoundingClientRect().height, 0);
      if (alto < ALTO_SOSPECHOSO) setRutaOculta(pathname);
    }, ESPERA_MS);
    return () => window.clearTimeout(temporizador);
  }, [pathname]);

  if (rutaOculta !== pathname || cerrado === pathname) return null;

  return (
    <div className="aviso-navegador" role="status">
      <span>
        <strong>Falta contenido en esta pantalla.</strong> Una extensión de tu navegador —casi siempre un bloqueador de
        anuncios— la está escondiendo. No es un fallo de la aplicación: añade este sitio a su lista de excepciones y
        recarga. Para comprobarlo, ábrela en una ventana de incógnito.
      </span>
      <button type="button" className="button button-compact button-secondary" onClick={() => setCerrado(pathname)}>Entendido</button>
    </div>
  );
}
