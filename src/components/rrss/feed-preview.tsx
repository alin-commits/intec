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

  Instagram pinta el perfil en tres columnas, con lo más nuevo arriba a la
  izquierda y los cuadros en 4:5 —verticales, no cuadrados: lo cambiaron en
  2025 y es lo que descoloca a todo el mundo, porque una foto cuadrada sale
  recortada por arriba y por abajo—. Esta pantalla hace lo mismo, con la
  opción de verlo en 1:1 para los feeds antiguos. Lo que entra se pone al
  principio, y el orden se cambia arrastrando o con las flechas, que es lo
  que funciona en el móvil.

  La cabecera del perfil está para que se vea en su sitio, como en el
  teléfono. Los textos y las cifras se pueden escribir encima: tampoco se
  guardan.
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
  const [formato, setFormato] = useState<"4:5" | "1:1">("4:5");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [perfil, setPerfil] = useState({
    nombre: "Suministros industriales | INTEC",
    usuario: "suministrointec",
    bio: "",
    seguidores: "",
    seguidos: "",
  });
  const entradaRef = useRef<HTMLInputElement>(null);
  const avatarRef = useRef<HTMLInputElement>(null);
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

  function ponerAvatar(lista: FileList | null | undefined) {
    const archivo = Array.from(lista ?? []).find((f) => f.type.startsWith("image/"));
    if (!archivo) return;
    if (avatar) {
      URL.revokeObjectURL(avatar);
      urlsRef.current = urlsRef.current.filter((url) => url !== avatar);
    }
    const url = URL.createObjectURL(archivo);
    urlsRef.current.push(url);
    setAvatar(url);
  }

  function escribirPerfil(campo: keyof typeof perfil, valor: string) {
    setPerfil((actual) => ({ ...actual, [campo]: valor }));
  }

  function vaciar() {
    // La foto de perfil no se va: lo que se vacía es el feed.
    for (const foto of fotos) URL.revokeObjectURL(foto.url);
    urlsRef.current = urlsRef.current.filter((url) => url === avatar);
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
            <div className={formato === "1:1" ? "feed-tray is-square" : "feed-tray"}>
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
                <p className="panel-subtitle">
                  Arrastra una foto sobre otra para cambiar el orden, o usa las flechas. Instagram recorta en 4:5
                  por el centro: lo que se ve aquí es lo que se verá allí.
                </p>
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
                <label className="feed-switch">
                  <span>Formato</span>
                  <select value={formato} onChange={(event) => setFormato(event.target.value as "4:5" | "1:1")}>
                    <option value="4:5">4:5, como Instagram</option>
                    <option value="1:1">1:1, cuadrado</option>
                  </select>
                </label>
              </div>
            </div>

            {enElFeed.length === 0 ? (
              <div className="empty-state">
                <strong>No hay ninguna foto marcada</strong>
                Pulsa arriba las que quieras ver publicadas.
              </div>
            ) : (
              <div className={anchoMovil ? "ig-phone" : "ig-phone is-wide"}>
                <header className="ig-profile">
                  <div className="ig-profile-top">
                    <button type="button" className="ig-avatar" onClick={() => avatarRef.current?.click()} title="Cambiar la foto de perfil">
                      {avatar
                        /* eslint-disable-next-line @next/next/no-img-element -- ver arriba: la foto no sale de este navegador */
                        ? <img src={avatar} alt="Foto de perfil" />
                        : <span className="ig-avatar-empty">{perfil.usuario.slice(0, 1).toUpperCase() || "?"}</span>}
                    </button>
                    <input ref={avatarRef} type="file" accept="image/*" hidden onChange={(event) => { ponerAvatar(event.target.files); event.target.value = ""; }} />
                    <div className="ig-stats">
                      <div className="ig-stat"><strong>{enElFeed.length}</strong><span>publicaciones</span></div>
                      <div className="ig-stat">
                        <input className="ig-field" value={perfil.seguidores} placeholder="0" aria-label="Seguidores" onChange={(event) => escribirPerfil("seguidores", event.target.value)} />
                        <span>seguidores</span>
                      </div>
                      <div className="ig-stat">
                        <input className="ig-field" value={perfil.seguidos} placeholder="0" aria-label="Seguidos" onChange={(event) => escribirPerfil("seguidos", event.target.value)} />
                        <span>seguidos</span>
                      </div>
                    </div>
                  </div>
                  <input className="ig-field ig-nombre" value={perfil.nombre} placeholder="Nombre del perfil" aria-label="Nombre del perfil" onChange={(event) => escribirPerfil("nombre", event.target.value)} />
                  <input className="ig-field ig-usuario" value={perfil.usuario} placeholder="usuario" aria-label="Nombre de usuario" onChange={(event) => escribirPerfil("usuario", event.target.value)} />
                  <textarea className="ig-field ig-bio" rows={2} value={perfil.bio} placeholder="La bio, si quieres verla aquí…" aria-label="Biografía" onChange={(event) => escribirPerfil("bio", event.target.value)} />
                </header>
                <nav className="ig-tabs" aria-hidden="true">
                  <span className="is-active" title="Publicaciones">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M15 3v18M3 9h18M3 15h18" /></svg>
                  </span>
                  <span title="Reels">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M3 8h18M9 3l3 5M15 3l3 5" /><path d="M11 11.5v5l4-2.5z" fill="currentColor" stroke="none" /></svg>
                  </span>
                  <span title="Etiquetadas">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="12" cy="10" r="2.6" /><path d="M7.5 18c.9-2.2 2.6-3.3 4.5-3.3s3.6 1.1 4.5 3.3" /></svg>
                  </span>
                </nav>
                <div className={`feed-grid${formato === "1:1" ? " is-square" : ""}${vistaLimpia ? " is-clean" : ""}`}>
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
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
