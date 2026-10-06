"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { Toast } from "@/components/ui/toast";

/*
  El visor del feed de Instagram: subes fotos, marcas las que irían publicadas
  y ves cómo queda la rejilla del perfil antes de publicar nada.

  No guarda nada y no lee nada. Las fotos no salen de este navegador: viven en
  memoria mientras la pestaña está abierta y desaparecen al recargar o al
  cambiar de pestaña. Es a propósito —esto es una mesa de pruebas, no un sitio
  donde dejar cosas— y por eso no hay ni base de datos ni almacenamiento por
  detrás. Tampoco se conecta con Instagram: lo que se ve es lo que tú subes.

  Instagram pinta el perfil en tres columnas, cuadradas, recortadas por el
  centro y con lo más nuevo arriba a la izquierda. Esta pantalla hace lo mismo,
  así que lo que entra se pone al principio. El orden se cambia arrastrando o
  con las flechas, que es lo que funciona en el móvil.
*/

type Foto = {
  id: string;
  nombre: string;
  url: string;
  /** Si está marcada para el feed. Las que no, se quedan en la bandeja. */
  enElFeed: boolean;
  /** El navegador no ha podido pintarla (pasa con los HEIC del iPhone). */
  ilegible?: boolean;
};

/** Suficientes para probar un perfil entero sin llenar la memoria de fotos sin comprimir. */
const MAXIMO = 90;

export function FeedPreview() {
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [encima, setEncima] = useState(false);
  const [moviendo, setMoviendo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [anchoMovil, setAnchoMovil] = useState(true);
  const [vistaLimpia, setVistaLimpia] = useState(false);
  const entradaRef = useRef<HTMLInputElement>(null);
  const urlsRef = useRef<string[]>([]);

  // Al salir de la pantalla se suelta la memoria que ocupaban las fotos.
  useEffect(() => () => {
    for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current = [];
  }, []);

  const enElFeed = fotos.filter((foto) => foto.enElFeed);

  function anadir(lista: FileList | null | undefined) {
    const imagenes = Array.from(lista ?? []).filter((archivo) => archivo.type.startsWith("image/"));
    if (imagenes.length === 0) {
      setAviso("Ahí no hay ninguna imagen. Valen JPG, PNG y WEBP.");
      return;
    }
    const sitio = Math.max(MAXIMO - fotos.length, 0);
    const entran = imagenes.slice(0, sitio);
    const nuevas: Foto[] = entran.map((archivo) => {
      const url = URL.createObjectURL(archivo);
      urlsRef.current.push(url);
      return { id: crypto.randomUUID(), nombre: archivo.name, url, enElFeed: true };
    });
    setFotos((actuales) => [...nuevas, ...actuales]);
    setAviso(entran.length < imagenes.length
      ? `Caben ${MAXIMO} fotos: se han añadido ${entran.length} y el resto se ha quedado fuera.`
      : null);
  }

  function soltarArchivos(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setEncima(false);
    // Arrastrar una foto de la rejilla no trae archivos: eso lo lleva la rejilla.
    if (!event.dataTransfer?.files?.length) return;
    anadir(event.dataTransfer.files);
  }

  function descartar(id: string) {
    const fuera = fotos.find((foto) => foto.id === id);
    if (!fuera) return;
    URL.revokeObjectURL(fuera.url);
    urlsRef.current = urlsRef.current.filter((url) => url !== fuera.url);
    setFotos((actuales) => actuales.filter((foto) => foto.id !== id));
  }

  function vaciar() {
    for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current = [];
    setFotos([]);
    setAviso(null);
  }

  function marcar(id: string) {
    setFotos((actuales) => actuales.map((foto) => foto.id === id ? { ...foto, enElFeed: !foto.enElFeed } : foto));
  }

  function noSePuedePintar(id: string) {
    setFotos((actuales) => actuales.map((foto) => foto.id === id ? { ...foto, ilegible: true } : foto));
  }

  /**
   * Mueve una foto un hueco en el feed. Cambia de sitio con la siguiente foto
   * marcada, no con la de al lado en la lista: si no, las que están en la
   * bandeja harían que las flechas no movieran nada.
   */
  function mover(id: string, hacia: -1 | 1) {
    setFotos((actuales) => {
      const desde = actuales.findIndex((foto) => foto.id === id);
      if (desde < 0) return actuales;
      let hasta = desde + hacia;
      while (hasta >= 0 && hasta < actuales.length && !actuales[hasta].enElFeed) hasta += hacia;
      if (hasta < 0 || hasta >= actuales.length) return actuales;
      const copia = [...actuales];
      [copia[desde], copia[hasta]] = [copia[hasta], copia[desde]];
      return copia;
    });
  }

  function soltarSobre(idDestino: string) {
    const idOrigen = moviendo;
    setMoviendo(null);
    if (!idOrigen || idOrigen === idDestino) return;
    setFotos((actuales) => {
      const desde = actuales.findIndex((foto) => foto.id === idOrigen);
      const hasta = actuales.findIndex((foto) => foto.id === idDestino);
      if (desde < 0 || hasta < 0) return actuales;
      const copia = [...actuales];
      const [movida] = copia.splice(desde, 1);
      copia.splice(hasta, 0, movida);
      return copia;
    });
  }

  return (
    <div className="page-stack">
      <Toast message={aviso} onDismiss={() => setAviso(null)} />

      <section
        className={encima ? "panel feed-dropzone dragging" : "panel feed-dropzone"}
        onDragOver={(event) => { event.preventDefault(); setEncima(true); }}
        onDragLeave={() => setEncima(false)}
        onDrop={soltarArchivos}
      >
        <div>
          <strong>Probar el feed antes de publicar</strong>
          <p className="muted">
            Arrastra aquí las fotos, o pulsa «Añadir fotos», y verás la rejilla del perfil tal cual la ve
            la gente. No se guarda nada ni se publica nada: las fotos no salen de este navegador y
            desaparecen al recargar o al cambiar de pestaña.
          </p>
        </div>
        <div className="panel-heading-trailing">
          <input
            ref={entradaRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => { anadir(event.target.files); event.target.value = ""; }}
          />
          <button type="button" className="button button-primary" onClick={() => entradaRef.current?.click()}>Añadir fotos</button>
          {fotos.length > 0 ? <button type="button" className="button button-secondary" onClick={vaciar}>Vaciar</button> : null}
        </div>
      </section>

      {fotos.length === 0 ? (
        <section className="panel panel-padded">
          <div className="empty-state">
            <strong>Todavía no has añadido ninguna foto</strong>
            Sube las que estés pensando publicar y se verán de tres en tres, cuadradas y con la más nueva
            arriba a la izquierda, igual que en Instagram.
          </div>
        </section>
      ) : (
        <>
          <section className="panel table-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">{enElFeed.length} de {fotos.length} en el feed</span>
                <h2>Fotos añadidas</h2>
                <p className="panel-subtitle">Pulsa una foto para quitarla del feed o volver a ponerla. La ✕ la descarta del todo.</p>
              </div>
            </div>
            <div className="feed-tray">
              {fotos.map((foto) => (
                <div key={foto.id} className={foto.enElFeed ? "feed-tray-item is-in" : "feed-tray-item"}>
                  <button
                    type="button"
                    className="feed-tray-pick"
                    onClick={() => marcar(foto.id)}
                    title={foto.nombre}
                    aria-label={foto.enElFeed ? `Quitar ${foto.nombre} del feed` : `Poner ${foto.nombre} en el feed`}
                    aria-pressed={foto.enElFeed}
                  >
                    {foto.ilegible
                      ? <span className="feed-ilegible">Esta foto no la puede abrir el navegador</span>
                      /* eslint-disable-next-line @next/next/no-img-element -- es un blob: del propio navegador, no hay nada que optimizar */
                      : <img src={foto.url} alt="" onError={() => noSePuedePintar(foto.id)} />}
                    {foto.enElFeed ? <span className="feed-tray-check" aria-hidden="true">✓</span> : null}
                  </button>
                  <button type="button" className="feed-tray-remove" onClick={() => descartar(foto.id)} aria-label={`Descartar ${foto.nombre}`}>✕</button>
                </div>
              ))}
            </div>
          </section>

          <section className="panel table-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Vista del perfil</span>
                <h2>Así quedaría el feed</h2>
                <p className="panel-subtitle">Arrastra una foto sobre otra para cambiar el orden, o usa las flechas.</p>
              </div>
              <div className="feed-switches">
                <label className="feed-switch">
                  <span>Ancho de móvil</span>
                  <span className="switch">
                    <input type="checkbox" checked={anchoMovil} onChange={(event) => setAnchoMovil(event.target.checked)} />
                    <span className="switch-track"><span className="switch-thumb" /></span>
                  </span>
                </label>
                <label className="feed-switch">
                  <span>Vista limpia</span>
                  <span className="switch">
                    <input type="checkbox" checked={vistaLimpia} onChange={(event) => setVistaLimpia(event.target.checked)} />
                    <span className="switch-track"><span className="switch-thumb" /></span>
                  </span>
                </label>
              </div>
            </div>

            {enElFeed.length === 0 ? (
              <div className="empty-state">
                <strong>No hay ninguna foto marcada</strong>
                Pulsa arriba las que quieras ver publicadas.
              </div>
            ) : (
              <div className={`feed-grid${anchoMovil ? " is-phone" : ""}${vistaLimpia ? " is-clean" : ""}`}>
                {enElFeed.map((foto, posicion) => (
                  <figure
                    key={foto.id}
                    className={moviendo === foto.id ? "feed-tile is-moving" : "feed-tile"}
                    draggable
                    onDragStart={() => setMoviendo(foto.id)}
                    onDragEnd={() => setMoviendo(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => soltarSobre(foto.id)}
                  >
                    {foto.ilegible
                      ? <span className="feed-ilegible">Esta foto no la puede abrir el navegador. Guárdala como JPG y vuelve a subirla.</span>
                      /* eslint-disable-next-line @next/next/no-img-element -- ver arriba: la foto no sale de este navegador */
                      : <img src={foto.url} alt={foto.nombre} onError={() => noSePuedePintar(foto.id)} />}
                    <figcaption className="feed-tile-bar">
                      <button
                        type="button"
                        className="feed-tile-button"
                        onClick={() => mover(foto.id, -1)}
                        disabled={posicion === 0}
                        aria-label={`Mover ${foto.nombre} una posición antes`}
                      >←</button>
                      <span>{posicion + 1}</span>
                      <button
                        type="button"
                        className="feed-tile-button"
                        onClick={() => mover(foto.id, 1)}
                        disabled={posicion === enElFeed.length - 1}
                        aria-label={`Mover ${foto.nombre} una posición después`}
                      >→</button>
                      <button
                        type="button"
                        className="feed-tile-button"
                        onClick={() => marcar(foto.id)}
                        aria-label={`Quitar ${foto.nombre} del feed`}
                      >✕</button>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
