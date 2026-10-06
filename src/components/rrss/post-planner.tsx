"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Modal } from "@/components/ui/modal";
import { PageLoader } from "@/components/ui/page-loader";
import { Toast } from "@/components/ui/toast";
import { hasAnyRole, socialNetworkLabels, socialNetworkOrder } from "@/lib/constants";
import { reportSafeError } from "@/lib/errors";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { loadCurrentProfile } from "@/lib/supabase/current-profile";
import { writeRows } from "@/lib/supabase/write";
import type { BusinessUnit, SocialNetwork } from "@/lib/types";

/*
  El organizador de publicaciones: las fotos que están por subir, con su texto,
  en el orden en que van a quedar en el perfil.

  Está pensado para trabajar, no solo para mirar. Se guarda por marca y por red,
  así que lo que se prepara un lunes sigue ahí el martes y lo ve quien tenga que
  verlo. Las fotos van a un cubo privado: es material sin publicar.

  La rejilla imita a Instagram porque es donde más se nota: tres columnas, lo
  más nuevo arriba a la izquierda y los cuadros en 4:5 —verticales, no
  cuadrados, lo cambiaron en 2025—, así que una foto pensada en cuadrado sale
  recortada por arriba y por abajo. Verla aquí antes de subirla es justo el
  motivo de esta pantalla.

  El orden lo decide una persona arrastrando, no una fecha: lo que importa es
  cómo quedan unas al lado de otras. Marcar una como subida no la mueve, para
  que el feed de abajo siga siendo el de verdad y lo nuevo se vea cayendo
  encima.
*/

type Post = {
  id: string;
  imagePath: string;
  fileName: string | null;
  caption: string;
  status: "pendiente" | "subida";
  position: number;
  /** Firmada al cargar; no se guarda en ningún sitio. */
  url: string | null;
};

type Formato = "4:5" | "1:1";
/** Lo grande que se ve el simulador. Crece entero: las proporciones no cambian. */
type Tamano = "movil" | "mediano" | "grande" | "enorme";
const CLASES_TAMANO: Record<Tamano, string> = {
  movil: "ig-phone is-movil",
  mediano: "ig-phone",
  grande: "ig-phone is-grande",
  enorme: "ig-phone is-enorme",
};

const CUBO = "social-posts";
/** Las firmas duran dos horas: lo que dura una sesión de preparar el feed. */
const FIRMA_SEGUNDOS = 7200;
const MAXIMO_POR_TANDA = 30;
/** Lo que deja escribir Instagram en un pie de foto. */
const MAXIMO_COPY = 2200;

/** Lo que se puede escribir encima del perfil simulado. No se guarda. */
type Cabecera = { nombre: string; usuario: string; bio: string; seguidores: string; seguidos: string };

export function PostPlanner() {
  const configured = isSupabaseConfigured();
  // Sin base de datos no hay nada que esperar: la pantalla ya está "cargada".
  const [cargando, setCargando] = useState(configured);
  const [canEdit, setCanEdit] = useState(false);
  const [unidades, setUnidades] = useState<BusinessUnit[]>([]);
  const [unidadId, setUnidadId] = useState("");
  const [red, setRed] = useState<SocialNetwork>("instagram");
  const [posts, setPosts] = useState<Post[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [encima, setEncima] = useState(false);
  const [moviendo, setMoviendo] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<Post | null>(null);
  const [borrador, setBorrador] = useState({ caption: "", status: "pendiente" as Post["status"] });
  const [borrando, setBorrando] = useState<Post | null>(null);
  const [tamano, setTamano] = useState<Tamano>("mediano");
  const [seleccionando, setSeleccionando] = useState(false);
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [preparando, setPreparando] = useState<string | null>(null);
  const [vistaLimpia, setVistaLimpia] = useState(false);
  const [formato, setFormato] = useState<Formato>("4:5");
  const [cabeceras, setCabeceras] = useState<Record<string, Partial<Cabecera>>>({});
  const entradaRef = useRef<HTMLInputElement>(null);

  // Al cambiar de marca o de red se vacía la rejilla a mano: si no, el feed de
  // la marca anterior se queda a la vista bajo el nombre de la nueva.
  const unidad = unidades.find((item) => item.id === unidadId) ?? null;
  const pendientes = posts.filter((post) => post.status === "pendiente").length;

  useEffect(() => {
    if (!configured) return;
    cargarInicio()
      .catch((causa: unknown) => setAviso(reportSafeError(causa, "No se pudieron cargar las marcas.")))
      .finally(() => setCargando(false));
  }, [configured]);

  useEffect(() => {
    if (!configured || !unidadId) return;
    cargarPosts(unidadId, red).catch((causa: unknown) => setAviso(reportSafeError(causa, "No se pudieron cargar las publicaciones.")));
  }, [configured, unidadId, red]);

  async function cargarPosts(unitId: string, network: SocialNetwork) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("social_posts")
      .select("id, image_path, file_name, caption, status, position")
      .eq("business_unit_id", unitId)
      .eq("network", network)
      .order("position")
      .order("created_at");
    if (error) throw error;
    const filas = (data ?? []) as { id: string; image_path: string; file_name: string | null; caption: string | null; status: Post["status"]; position: number }[];
    // Las fotos están en un cubo privado: cada una necesita su firma para verse.
    const firmas = new Map<string, string>();
    if (filas.length > 0) {
      const { data: urls } = await supabase.storage.from(CUBO).createSignedUrls(filas.map((fila) => fila.image_path), FIRMA_SEGUNDOS);
      for (const firma of urls ?? []) {
        if (firma.path && firma.signedUrl) firmas.set(firma.path, firma.signedUrl);
      }
    }
    setPosts(filas.map((fila) => ({
      id: fila.id,
      imagePath: fila.image_path,
      fileName: fila.file_name,
      caption: fila.caption ?? "",
      status: fila.status,
      position: fila.position,
      url: firmas.get(fila.image_path) ?? null,
    })));
  }

  /** Las marcas y lo que puede hacer quien entra. Solo al abrir la pantalla. */
  async function cargarInicio() {
    const supabase = createClient();
    const [perfil, { data: filas, error }] = await Promise.all([
      loadCurrentProfile(),
      supabase.from("business_units").select("id, name, slug, brand_color, logo_url, is_active, sort_order").eq("is_active", true).order("sort_order"),
    ]);
    if (error) throw error;
    setCanEdit(hasAnyRole(perfil?.roles ?? [], ["admin", "marketing"]));
    const activas = (filas ?? []).map((fila) => ({
      id: String(fila.id),
      name: String(fila.name),
      slug: String(fila.slug),
      accent: String(fila.brand_color ?? "#4f46e5"),
      logo: fila.logo_url ? String(fila.logo_url) : null,
      active: true,
      sortOrder: Number(fila.sort_order ?? 0),
      visibleInConsultas: true,
      visibleInLeads: true,
    })) as BusinessUnit[];
    setUnidades(activas);
    setUnidadId(activas[0]?.id ?? "");
  }

  async function anadir(lista: FileList | null | undefined) {
    const imagenes = Array.from(lista ?? []).filter((archivo) => archivo.type.startsWith("image/"));
    if (imagenes.length === 0) {
      setAviso("Ahí no hay ninguna imagen. Valen JPG, PNG y WEBP.");
      return;
    }
    if (!unidadId) return;
    const entran = imagenes.slice(0, MAXIMO_POR_TANDA);
    setBusy(true);
    try {
      const supabase = createClient();
      // Lo nuevo va delante: por debajo de la posición más baja que haya.
      const base = posts.reduce((menor, post) => Math.min(menor, post.position), 0) - entran.length;
      const filas: Record<string, unknown>[] = [];
      const fallidas: string[] = [];
      for (const [indice, archivo] of entran.entries()) {
        const extension = archivo.name.includes(".") ? archivo.name.split(".").pop()!.toLowerCase().slice(0, 5) : "jpg";
        const ruta = `${unidadId}/${red}/${crypto.randomUUID()}.${extension}`;
        const { error } = await supabase.storage.from(CUBO).upload(ruta, archivo, { contentType: archivo.type, upsert: false });
        if (error) { fallidas.push(archivo.name); continue; }
        filas.push({
          business_unit_id: unidadId,
          network: red,
          image_path: ruta,
          file_name: archivo.name.slice(0, 200),
          position: base + indice,
        });
      }
      if (filas.length > 0) {
        const { error } = await supabase.from("social_posts").insert(filas);
        if (error) throw error;
      }
      await cargarPosts(unidadId, red);
      setAviso(fallidas.length > 0
        ? `No se pudieron subir ${fallidas.length} de ${entran.length} fotos. Vuelve a intentarlo con esas.`
        : entran.length < imagenes.length
          ? `Van de ${MAXIMO_POR_TANDA} en ${MAXIMO_POR_TANDA}: se han subido las ${entran.length} primeras.`
          : entran.length === 1 ? "Foto añadida." : `${entran.length} fotos añadidas.`);
    } catch (causa) {
      setAviso(reportSafeError(causa, "No se pudieron subir las fotos."));
    } finally {
      setBusy(false);
    }
  }

  function soltarArchivos(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setEncima(false);
    // Arrastrar una foto de la rejilla no trae archivos: eso lo lleva la rejilla.
    if (!canEdit || !event.dataTransfer?.files?.length) return;
    void anadir(event.dataTransfer.files);
  }

  /**
   * Guarda el orden nuevo. Las posiciones que había se reparten entre las
   * mismas fotos en otro orden, así que solo se escriben las que se mueven de
   * sitio: arrastrar una foto no reescribe el feed entero.
   */
  async function guardarOrden(ordenado: Post[]) {
    const posiciones = posts.map((post) => post.position).sort((uno, otro) => uno - otro);
    const conPosicion = ordenado.map((post, indice) => ({ ...post, position: posiciones[indice] }));
    const cambiadas = conPosicion.filter((post) => posts.find((viejo) => viejo.id === post.id)?.position !== post.position);
    setPosts(conPosicion);
    if (cambiadas.length === 0) return;
    try {
      const supabase = createClient();
      for (const post of cambiadas) {
        await writeRows(
          supabase.from("social_posts").update({ position: post.position }).eq("id", post.id),
          "No se pudo guardar el orden: puede que alguien haya borrado esa publicación o que tu rol no permita cambiarla.",
        );
      }
    } catch (causa) {
      setAviso(reportSafeError(causa, "No se pudo guardar el orden."));
      await cargarPosts(unidadId, red).catch(() => undefined);
    }
  }

  function mover(id: string, hacia: -1 | 1) {
    const desde = posts.findIndex((post) => post.id === id);
    const hasta = desde + hacia;
    if (desde < 0 || hasta < 0 || hasta >= posts.length) return;
    const copia = [...posts];
    [copia[desde], copia[hasta]] = [copia[hasta], copia[desde]];
    void guardarOrden(copia);
  }

  function soltarSobre(idDestino: string) {
    const idOrigen = moviendo;
    setMoviendo(null);
    if (!idOrigen || idOrigen === idDestino) return;
    const desde = posts.findIndex((post) => post.id === idOrigen);
    const hasta = posts.findIndex((post) => post.id === idDestino);
    if (desde < 0 || hasta < 0) return;
    const copia = [...posts];
    const [movida] = copia.splice(desde, 1);
    copia.splice(hasta, 0, movida);
    void guardarOrden(copia);
  }

  async function cambiarEstado(post: Post, status: Post["status"]) {
    setPosts((actuales) => actuales.map((item) => item.id === post.id ? { ...item, status } : item));
    try {
      await writeRows(
        createClient().from("social_posts").update({ status }).eq("id", post.id),
        "No se pudo marcar: puede que alguien la haya borrado o que tu rol no permita cambiarla.",
      );
    } catch (causa) {
      setPosts((actuales) => actuales.map((item) => item.id === post.id ? { ...item, status: post.status } : item));
      setAviso(reportSafeError(causa, "No se pudo marcar la publicación."));
    }
  }

  async function guardarFicha() {
    if (!abierto) return;
    setBusy(true);
    try {
      await writeRows(
        createClient().from("social_posts").update({ caption: borrador.caption.trim() || null, status: borrador.status }).eq("id", abierto.id),
        "No se pudo guardar: puede que alguien haya borrado la publicación o que tu rol no permita cambiarla.",
      );
      setPosts((actuales) => actuales.map((item) => item.id === abierto.id ? { ...item, caption: borrador.caption, status: borrador.status } : item));
      setAbierto(null);
      setAviso("Publicación guardada.");
    } catch (causa) {
      setAviso(reportSafeError(causa, "No se pudo guardar la publicación."));
    } finally {
      setBusy(false);
    }
  }

  async function confirmarBorrado() {
    if (!borrando) return;
    setBusy(true);
    try {
      const supabase = createClient();
      // Primero la ficha: si se fuera antes la foto, quedaría un hueco roto.
      await writeRows(
        supabase.from("social_posts").delete().eq("id", borrando.id),
        "No se pudo eliminar. Comprueba que tu rol permite borrar publicaciones.",
      );
      await supabase.storage.from(CUBO).remove([borrando.imagePath]);
      setPosts((actuales) => actuales.filter((post) => post.id !== borrando.id));
      setBorrando(null);
      setAbierto(null);
      setAviso("Publicación eliminada.");
    } catch (causa) {
      setAviso(reportSafeError(causa, "No se pudo eliminar la publicación."));
    } finally {
      setBusy(false);
    }
  }

  /**
   * La foto recortada tal y como se ve en la rejilla. Se baja primero el
   * archivo y se dibuja desde aquí: así el lienzo no queda marcado como de
   * otro sitio y el navegador deja exportarlo.
   */
  async function recortar(direccion: string): Promise<Blob> {
    const respuesta = await fetch(direccion);
    const original = await respuesta.blob();
    const urlLocal = URL.createObjectURL(original);
    try {
      const imagen = new Image();
      imagen.src = urlLocal;
      await imagen.decode();
      const proporcion = formato === "4:5" ? 4 / 5 : 1;
      const suya = imagen.naturalWidth / imagen.naturalHeight;
      const ancho = suya > proporcion ? imagen.naturalHeight * proporcion : imagen.naturalWidth;
      const alto = suya > proporcion ? imagen.naturalHeight : imagen.naturalWidth / proporcion;
      const lienzo = document.createElement("canvas");
      lienzo.width = Math.round(ancho);
      lienzo.height = Math.round(alto);
      const pincel = lienzo.getContext("2d");
      if (!pincel) throw new Error("Sin lienzo");
      pincel.drawImage(imagen, (imagen.naturalWidth - ancho) / 2, (imagen.naturalHeight - alto) / 2, ancho, alto, 0, 0, lienzo.width, lienzo.height);
      const recortada = await new Promise<Blob | null>((listo) => lienzo.toBlob(listo, "image/jpeg", 0.92));
      return recortada ?? original;
    } finally {
      URL.revokeObjectURL(urlLocal);
    }
  }

  const nombreDeArchivo = (post: Post, posicion: number) =>
    `${String(posicion + 1).padStart(2, "0")}-${(post.fileName ?? "foto").replace(/\.[^.]+$/, "").slice(0, 40)}.jpg`;

  async function descargar(post: Post) {
    if (!post.url) return;
    setBusy(true);
    try {
      const recortada = await recortar(post.url);
      bajar(recortada, `${unidad?.slug ?? "post"}-${formato.replace(":", "x")}-${(post.fileName ?? "foto").replace(/\.[^.]+$/, "")}.jpg`);
    } catch (causa) {
      setAviso(reportSafeError(causa, "No se pudo preparar la descarga."));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Varias de golpe, en un zip. Van numeradas en el orden del feed, que es el
   * orden en que hay que subirlas, y si alguna tiene texto se añade un
   * `textos.txt` con los mismos números: copiar ocho copys a mano uno por uno
   * era justo lo que había que evitar.
   */
  async function descargarSeleccionadas() {
    const elegidas = posts.map((post, posicion) => ({ post, posicion })).filter(({ post }) => seleccion.includes(post.id));
    if (elegidas.length === 0) return;
    setPreparando(`0 de ${elegidas.length}`);
    try {
      const archivos: Record<string, Uint8Array> = {};
      const textos: string[] = [];
      const fallidas: string[] = [];
      for (const [hechas, { post, posicion }] of elegidas.entries()) {
        setPreparando(`${hechas} de ${elegidas.length}`);
        if (!post.url) { fallidas.push(post.fileName ?? "una foto"); continue; }
        const nombre = nombreDeArchivo(post, posicion);
        archivos[nombre] = new Uint8Array(await (await recortar(post.url)).arrayBuffer());
        if (post.caption.trim()) textos.push(`${nombre}\n${post.caption.trim()}\n`);
      }
      if (textos.length > 0) archivos["textos.txt"] = new TextEncoder().encode(textos.join("\n"));
      if (Object.keys(archivos).length === 0) throw new Error("Sin archivos");
      // El zip se carga solo cuando hace falta, no al abrir la pantalla.
      const { zipSync } = await import("fflate");
      // Nivel 0: un JPEG ya viene comprimido, apretarlo otra vez solo tarda.
      const zip = zipSync(archivos, { level: 0 });
      const hoy = new Date().toISOString().slice(0, 10);
      bajar(new Blob([zip as BlobPart], { type: "application/zip" }), `${unidad?.slug ?? "posts"}-${red}-${formato.replace(":", "x")}-${hoy}.zip`);
      setAviso(fallidas.length > 0
        ? `Descargadas ${Object.keys(archivos).length - (textos.length > 0 ? 1 : 0)}; ${fallidas.length} no se pudieron preparar.`
        : `${elegidas.length} ${elegidas.length === 1 ? "foto descargada" : "fotos descargadas"} en un zip.`);
    } catch (causa) {
      setAviso(reportSafeError(causa, "No se pudo preparar la descarga."));
    } finally {
      setPreparando(null);
    }
  }

  function alternarSeleccion(id: string) {
    setSeleccion((actual) => actual.includes(id) ? actual.filter((item) => item !== id) : [...actual, id]);
  }

  function salirDeSeleccion() {
    setSeleccionando(false);
    setSeleccion([]);
  }

  function bajar(contenido: Blob, nombre: string) {
    const url = URL.createObjectURL(contenido);
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = nombre;
    enlace.click();
    URL.revokeObjectURL(url);
  }

  async function copiarCopy(post: Post) {
    if (!post.caption.trim()) { setAviso("Esta publicación todavía no tiene texto."); return; }
    try {
      await navigator.clipboard.writeText(post.caption);
      setAviso("Texto copiado: ya lo puedes pegar en Instagram.");
    } catch {
      setAviso("El navegador no ha dejado copiar. Selecciónalo a mano desde la ficha.");
    }
  }

  function abrirFicha(post: Post) {
    setAbierto(post);
    setBorrador({ caption: post.caption, status: post.status });
  }

  function escribirCabecera(campo: keyof Cabecera, valor: string) {
    setCabeceras((actuales) => ({ ...actuales, [unidadId]: { ...actuales[unidadId], [campo]: valor } }));
  }

  if (!configured) {
    return (
      <div className="page-stack">
        <section className="panel panel-padded">
          <h2>Hace falta la base de datos</h2>
          <p>El organizador guarda las publicaciones y sus fotos, así que no funciona en el modo de demostración.</p>
        </section>
      </div>
    );
  }

  if (cargando) return <PageLoader label="Cargando las publicaciones…" />;

  const cabecera = cabeceras[unidadId] ?? {};
  const nombrePerfil = cabecera.nombre ?? unidad?.name ?? "";
  const usuarioPerfil = cabecera.usuario ?? unidad?.slug ?? "";

  return (
    <div className="page-stack">
      <Toast message={aviso} onDismiss={() => setAviso(null)} />

      <section
        className={encima ? "panel feed-dropzone dragging" : "panel feed-dropzone"}
        onDragOver={(event) => { event.preventDefault(); if (canEdit) setEncima(true); }}
        onDragLeave={() => setEncima(false)}
        onDrop={soltarArchivos}
      >
        <div>
          <strong>Las publicaciones preparadas, en el orden en que van a quedar</strong>
          <p className="muted">
            {canEdit
              ? "Arrastra aquí las fotos o pulsa «Añadir fotos». Pulsa una para escribir su texto, descargarla recortada o marcarla como subida. Se guarda por marca y por red."
              : "Las publicaciones que marketing tiene preparadas. Puedes verlas y descargarlas."}
          </p>
          <div className="feed-scope">
            <label>
              <span>Marca</span>
              <select value={unidadId} onChange={(event) => { setPosts([]); setUnidadId(event.target.value); }}>
                {unidades.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>
              <span>Red</span>
              <select value={red} onChange={(event) => { setPosts([]); setRed(event.target.value as SocialNetwork); }}>
                {socialNetworkOrder.map((item) => <option key={item} value={item}>{socialNetworkLabels[item]}</option>)}
              </select>
            </label>
          </div>
        </div>
        <div className="panel-heading-trailing">
          {canEdit ? (
            <>
              <input
                ref={entradaRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(event) => { void anadir(event.target.files); event.target.value = ""; }}
              />
              <button type="button" className="button button-primary" disabled={busy || !unidadId} onClick={() => entradaRef.current?.click()}>
                {busy ? "Subiendo…" : "Añadir fotos"}
              </button>
            </>
          ) : null}
        </div>
      </section>

      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">
              {posts.length === 0
                ? "Sin publicaciones"
                : `${pendientes} por subir · ${posts.length - pendientes} ${posts.length - pendientes === 1 ? "ya subida" : "ya subidas"}`}
            </span>
            <h2>{red === "instagram" ? "Así quedaría el perfil" : `Preparado para ${socialNetworkLabels[red]}`}</h2>
            <p className="panel-subtitle">
              Arrastra una foto sobre otra para cambiar el orden, o usa las flechas. Instagram recorta en 4:5 por el
              centro: lo que se ve aquí es lo que se verá allí.
            </p>
          </div>
          <div className="feed-switches">
            <label className="feed-switch">
              <span>Tamaño</span>
              <select value={tamano} onChange={(event) => setTamano(event.target.value as Tamano)}>
                <option value="movil">Como en el móvil</option>
                <option value="mediano">Mediano</option>
                <option value="grande">Grande</option>
                <option value="enorme">Muy grande</option>
              </select>
            </label>
            <label className="feed-switch">
              <span>Vista limpia</span>
              <span className="switch">
                <input type="checkbox" checked={vistaLimpia} onChange={(event) => setVistaLimpia(event.target.checked)} />
                <span className="switch-track"><span className="switch-thumb" /></span>
              </span>
            </label>
            {canEdit || posts.length > 0 ? (
              <button
                type="button"
                className={seleccionando ? "button button-compact button-primary" : "button button-compact button-secondary"}
                onClick={() => (seleccionando ? salirDeSeleccion() : setSeleccionando(true))}
              >
                {seleccionando ? "Salir de seleccionar" : "Seleccionar varias"}
              </button>
            ) : null}
            <label className="feed-switch">
              <span>Formato</span>
              <select value={formato} onChange={(event) => setFormato(event.target.value as Formato)}>
                <option value="4:5">4:5, como Instagram</option>
                <option value="1:1">1:1, cuadrado</option>
              </select>
            </label>
          </div>
        </div>

        {seleccionando && posts.length > 0 ? (
          <div className="feed-seleccion">
            <strong>{seleccion.length === 0 ? "Ninguna seleccionada" : `${seleccion.length} ${seleccion.length === 1 ? "seleccionada" : "seleccionadas"}`}</strong>
            <button type="button" className="button button-compact button-secondary" onClick={() => setSeleccion(posts.map((post) => post.id))}>Todas</button>
            <button type="button" className="button button-compact button-secondary" disabled={seleccion.length === 0} onClick={() => setSeleccion([])}>Ninguna</button>
            <button
              type="button"
              className="button button-compact button-primary"
              disabled={seleccion.length === 0 || preparando !== null}
              onClick={() => void descargarSeleccionadas()}
            >
              {preparando ? `Preparando… ${preparando}` : `Descargar ${seleccion.length || ""} en ${formato}`}
            </button>
            <small className="muted">Van numeradas en el orden del feed, y con su texto en un archivo aparte.</small>
          </div>
        ) : null}

        {posts.length === 0 ? (
          <div className="empty-state">
            <strong>Todavía no hay nada preparado para esta marca</strong>
            {canEdit
              ? "Sube las fotos que estéis pensando publicar y se verán de tres en tres, como en el perfil."
              : "Cuando marketing prepare publicaciones, saldrán aquí."}
          </div>
        ) : (
          <div className={CLASES_TAMANO[tamano]}>
            {red === "instagram" ? (
              <>
                <header className="ig-profile">
                  <div className="ig-profile-top">
                    <span className="ig-avatar" aria-hidden="true">
                      {unidad?.logo
                        /* eslint-disable-next-line @next/next/no-img-element -- el logo de la marca, servido por Supabase */
                        ? <img src={unidad.logo} alt="" />
                        : <span className="ig-avatar-empty">{usuarioPerfil.slice(0, 1).toUpperCase() || "?"}</span>}
                    </span>
                    <div className="ig-stats">
                      <div className="ig-stat"><strong>{posts.length - pendientes}</strong><span>publicaciones</span></div>
                      <div className="ig-stat">
                        <input className="ig-field" value={cabecera.seguidores ?? ""} placeholder="0" aria-label="Seguidores" onChange={(event) => escribirCabecera("seguidores", event.target.value)} />
                        <span>seguidores</span>
                      </div>
                      <div className="ig-stat">
                        <input className="ig-field" value={cabecera.seguidos ?? ""} placeholder="0" aria-label="Seguidos" onChange={(event) => escribirCabecera("seguidos", event.target.value)} />
                        <span>seguidos</span>
                      </div>
                    </div>
                  </div>
                  <input className="ig-field ig-nombre" value={nombrePerfil} aria-label="Nombre del perfil" onChange={(event) => escribirCabecera("nombre", event.target.value)} />
                  <input className="ig-field ig-usuario" value={usuarioPerfil} aria-label="Nombre de usuario" onChange={(event) => escribirCabecera("usuario", event.target.value)} />
                  <textarea className="ig-field ig-bio" rows={2} value={cabecera.bio ?? ""} placeholder="La bio, si quieres verla aquí…" aria-label="Biografía" onChange={(event) => escribirCabecera("bio", event.target.value)} />
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
              </>
            ) : null}
            <div className={`feed-grid${formato === "1:1" ? " is-square" : ""}${vistaLimpia ? " is-clean" : ""}`}>
              {posts.map((post, posicion) => (
                <figure
                  key={post.id}
                  className={`feed-tile${moviendo === post.id ? " is-moving" : ""}${post.status === "pendiente" ? " is-pending" : ""}`}
                  draggable={canEdit && !seleccionando}
                  onDragStart={() => canEdit && !seleccionando && setMoviendo(post.id)}
                  onDragEnd={() => setMoviendo(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => soltarSobre(post.id)}
                >
                  <button
                    type="button"
                    className="feed-tile-open"
                    onClick={() => (seleccionando ? alternarSeleccion(post.id) : abrirFicha(post))}
                    aria-label={seleccionando ? `Seleccionar ${post.fileName ?? "la publicación"}` : `Abrir ${post.fileName ?? "la publicación"}`}
                    aria-pressed={seleccionando ? seleccion.includes(post.id) : undefined}
                  >
                    {post.url
                      /* eslint-disable-next-line @next/next/no-img-element -- firmada por Supabase, no hay nada que optimizar */
                      ? <img src={post.url} alt={post.fileName ?? "Publicación preparada"} />
                      : <span className="feed-ilegible">No se pudo cargar esta foto</span>}
                    {seleccionando ? <span className={seleccion.includes(post.id) ? "feed-marca is-on" : "feed-marca"} aria-hidden="true">{seleccion.includes(post.id) ? "✓" : ""}</span> : null}
                    {post.status === "pendiente" ? <span className="feed-tag">Por subir</span> : null}
                    {post.caption.trim() ? <span className="feed-tag feed-tag-copy" title={post.caption}>✎</span> : null}
                  </button>
                  <figcaption className="feed-tile-bar">
                    {canEdit ? (
                      <>
                        <button type="button" className="feed-tile-button" onClick={() => mover(post.id, -1)} disabled={posicion === 0} aria-label="Mover una posición antes">←</button>
                        <span>{posicion + 1}</span>
                        <button type="button" className="feed-tile-button" onClick={() => mover(post.id, 1)} disabled={posicion === posts.length - 1} aria-label="Mover una posición después">→</button>
                        <button
                          type="button"
                          className={post.status === "subida" ? "feed-tile-button is-on" : "feed-tile-button"}
                          onClick={() => void cambiarEstado(post, post.status === "subida" ? "pendiente" : "subida")}
                          aria-label={post.status === "subida" ? "Marcar como pendiente" : "Marcar como subida"}
                          aria-pressed={post.status === "subida"}
                        >✓</button>
                      </>
                    ) : <span>{posicion + 1}</span>}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        )}
      </section>

      <Modal open={Boolean(abierto)} title="Publicación" eyebrow={unidad?.name ?? ""} onClose={() => setAbierto(null)}>
        {abierto ? (
          <div className="post-ficha">
            <div className={formato === "1:1" ? "post-ficha-foto is-square" : "post-ficha-foto"}>
              {abierto.url
                /* eslint-disable-next-line @next/next/no-img-element -- firmada por Supabase */
                ? <img src={abierto.url} alt={abierto.fileName ?? "Publicación preparada"} />
                : <span className="feed-ilegible">No se pudo cargar esta foto</span>}
            </div>
            <div className="post-ficha-datos">
              <label>
                <span>Texto de la publicación</span>
                <textarea
                  rows={8}
                  maxLength={MAXIMO_COPY}
                  value={borrador.caption}
                  readOnly={!canEdit}
                  placeholder="El copy que irá debajo de la foto…"
                  onChange={(event) => setBorrador((actual) => ({ ...actual, caption: event.target.value }))}
                />
              </label>
              <small className="muted">{borrador.caption.length} de {MAXIMO_COPY} caracteres{abierto.fileName ? ` · ${abierto.fileName}` : ""}</small>
              {canEdit ? (
                <label className="feed-switch post-ficha-estado">
                  <span>Ya está subida</span>
                  <span className="switch">
                    <input
                      type="checkbox"
                      checked={borrador.status === "subida"}
                      onChange={(event) => setBorrador((actual) => ({ ...actual, status: event.target.checked ? "subida" : "pendiente" }))}
                    />
                    <span className="switch-track"><span className="switch-thumb" /></span>
                  </span>
                </label>
              ) : null}
              <div className="post-ficha-acciones">
                <button type="button" className="button button-secondary" disabled={busy} onClick={() => void descargar(abierto)}>Descargar en {formato}</button>
                <button type="button" className="button button-secondary" onClick={() => void copiarCopy({ ...abierto, caption: borrador.caption })}>Copiar texto</button>
                {canEdit ? <button type="button" className="button button-secondary" onClick={() => setBorrando(abierto)}>Eliminar</button> : null}
              </div>
            </div>
          </div>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={() => setAbierto(null)}>Cerrar</button>
          {canEdit ? <button type="button" className="button button-primary" disabled={busy} onClick={() => void guardarFicha()}>{busy ? "Guardando…" : "Guardar"}</button> : null}
        </div>
      </Modal>

      <ConfirmationDialog
        open={Boolean(borrando)}
        title="Eliminar la publicación"
        confirmLabel="Eliminar"
        busy={busy}
        onCancel={() => setBorrando(null)}
        onConfirm={() => void confirmarBorrado()}
      >
        <div className="confirmation-summary">
          <span>Publicación</span><strong>{borrando?.fileName ?? "Sin nombre"}</strong>
          <span>Efecto</span><strong>Se borra la foto y su texto. No se puede deshacer.</strong>
        </div>
      </ConfirmationDialog>
    </div>
  );
}
