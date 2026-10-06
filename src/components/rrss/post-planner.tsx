"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Modal } from "@/components/ui/modal";
import { PageLoader } from "@/components/ui/page-loader";
import { Toast } from "@/components/ui/toast";
import { hasAnyRole, socialNetworkLabels } from "@/lib/constants";
import { reportSafeError } from "@/lib/errors";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { loadCurrentProfile } from "@/lib/supabase/current-profile";
import { writeRows } from "@/lib/supabase/write";
import type { BusinessUnit, SocialNetwork } from "@/lib/types";

/*
  El organizador de publicaciones: las fotos que están por subir, con su texto,
  en el orden en que van a quedar en el perfil.

  Está pensado para trabajar, no solo para mirar. Se guarda por marca y por
  canal, así que lo que se prepara un lunes sigue ahí el martes y lo ve quien
  tenga que verlo. Las fotos van a un cubo privado: es material sin publicar.

  Tres cosas que vienen de cómo se publica aquí y conviene no olvidar:

   · Instagram y Facebook van juntos: la misma foto, distinto texto. Por eso
     son una sola lista y el copy se escribe por red dentro de la ficha.
     LinkedIn es su propia lista, porque allí los creativos son otros.
   · Una publicación son SUS fotos, no una foto. Varias es un carrusel; en el
     perfil solo se ve la primera, así que la rejilla no cambia.
   · La rejilla imita a Instagram porque es donde más se nota: tres columnas,
     lo más nuevo arriba a la izquierda y los cuadros en 4:5 —verticales, no
     cuadrados, lo cambiaron en 2025—, así que una foto pensada en cuadrado
     sale recortada por arriba y por abajo. Verla aquí antes de subirla es
     justo el motivo de esta pantalla.

  El orden lo decide una persona arrastrando, no una fecha: lo que importa es
  cómo quedan unas al lado de otras. Marcar una como subida no la mueve, para
  que el feed de abajo siga siendo el de verdad y lo nuevo se vea cayendo
  encima.
*/

type Imagen = {
  id: string;
  path: string;
  fileName: string | null;
  /** Firmada al cargar; no se guarda en ningún sitio. */
  url: string | null;
};

type Post = {
  id: string;
  /** El texto de cada red. Vacío en una red significa que ahí no se publica. */
  captions: Record<string, string>;
  status: "pendiente" | "subida";
  position: number;
  imagenes: Imagen[];
};

type Formato = "4:5" | "1:1";
/** Lo grande que se ve el simulador. Crece entero: las proporciones no cambian. */
type Tamano = "movil" | "mediano" | "grande" | "enorme";
/** Una lista de publicaciones. Instagram y Facebook comparten foto, así que comparten lista. */
type Canal = "instagram" | "linkedin";

const CLASES_TAMANO: Record<Tamano, string> = {
  movil: "ig-phone is-movil",
  mediano: "ig-phone",
  grande: "ig-phone is-grande",
  enorme: "ig-phone is-enorme",
};

const CANALES: { canal: Canal; etiqueta: string; redes: SocialNetwork[] }[] = [
  { canal: "instagram", etiqueta: "Instagram y Facebook", redes: ["instagram", "facebook"] },
  { canal: "linkedin", etiqueta: "LinkedIn", redes: ["linkedin"] },
];

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
  const [canal, setCanal] = useState<Canal>("instagram");
  const [posts, setPosts] = useState<Post[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [encima, setEncima] = useState(false);
  const [moviendo, setMoviendo] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<Post | null>(null);
  const [borrador, setBorrador] = useState({ captions: {} as Record<string, string>, status: "pendiente" as Post["status"] });
  const [redActiva, setRedActiva] = useState<SocialNetwork>("instagram");
  const [imagenActiva, setImagenActiva] = useState(0);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const [borrando, setBorrando] = useState<Post | null>(null);
  const [tamano, setTamano] = useState<Tamano>("mediano");
  const [vistaLimpia, setVistaLimpia] = useState(false);
  const [formato, setFormato] = useState<Formato>("4:5");
  const [seleccionando, setSeleccionando] = useState(false);
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [preparando, setPreparando] = useState<string | null>(null);
  const [cabeceras, setCabeceras] = useState<Record<string, Partial<Cabecera>>>({});
  const entradaRef = useRef<HTMLInputElement>(null);
  const entradaCarruselRef = useRef<HTMLInputElement>(null);

  const unidad = unidades.find((item) => item.id === unidadId) ?? null;
  const redesDelCanal = CANALES.find((item) => item.canal === canal)?.redes ?? ["instagram"];
  const pendientes = posts.filter((post) => post.status === "pendiente").length;

  useEffect(() => {
    if (!configured) return;
    cargarInicio()
      .catch((causa: unknown) => setAviso(reportSafeError(causa, "No se pudieron cargar las marcas.")))
      .finally(() => setCargando(false));
  }, [configured]);

  useEffect(() => {
    if (!configured || !unidadId) return;
    cargarPosts(unidadId, canal).catch((causa: unknown) => setAviso(reportSafeError(causa, "No se pudieron cargar las publicaciones.")));
  }, [configured, unidadId, canal]);

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

  async function cargarPosts(unitId: string, lista: Canal) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("social_posts")
      .select("id, captions, status, position")
      .eq("business_unit_id", unitId)
      .eq("network", lista)
      .order("position")
      .order("created_at");
    if (error) throw error;
    const filas = (data ?? []) as { id: string; captions: Record<string, string> | null; status: Post["status"]; position: number }[];

    const { data: fotos, error: errorFotos } = filas.length === 0
      ? { data: [], error: null }
      : await supabase
        .from("social_post_images")
        .select("id, post_id, image_path, file_name, position")
        .in("post_id", filas.map((fila) => fila.id))
        .order("post_id")
        .order("position");
    if (errorFotos) throw errorFotos;
    const imagenes = (fotos ?? []) as { id: string; post_id: string; image_path: string; file_name: string | null; position: number }[];

    // Las fotos están en un cubo privado: cada una necesita su firma para verse.
    const firmas = new Map<string, string>();
    if (imagenes.length > 0) {
      const { data: urls } = await supabase.storage.from(CUBO).createSignedUrls(imagenes.map((imagen) => imagen.image_path), FIRMA_SEGUNDOS);
      for (const firma of urls ?? []) {
        if (firma.path && firma.signedUrl) firmas.set(firma.path, firma.signedUrl);
      }
    }

    setPosts(filas.map((fila) => ({
      id: fila.id,
      captions: fila.captions ?? {},
      status: fila.status,
      position: fila.position,
      imagenes: imagenes
        .filter((imagen) => imagen.post_id === fila.id)
        .map((imagen) => ({ id: imagen.id, path: imagen.image_path, fileName: imagen.file_name, url: firmas.get(imagen.image_path) ?? null })),
    })));
  }

  const soloImagenes = (lista: FileList | null | undefined) =>
    Array.from(lista ?? []).filter((archivo) => archivo.type.startsWith("image/"));

  async function subirAlCubo(archivo: File): Promise<{ path: string; fileName: string } | null> {
    const extension = archivo.name.includes(".") ? archivo.name.split(".").pop()!.toLowerCase().slice(0, 5) : "jpg";
    const ruta = `${unidadId}/${canal}/${crypto.randomUUID()}.${extension}`;
    const { error } = await createClient().storage.from(CUBO).upload(ruta, archivo, { contentType: archivo.type, upsert: false });
    if (error) return null;
    return { path: ruta, fileName: archivo.name.slice(0, 200) };
  }

  /** Cada foto entra como una publicación suya. Para juntarlas, la ficha. */
  async function anadir(lista: FileList | null | undefined) {
    const imagenes = soloImagenes(lista);
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
      const nuevos: Record<string, unknown>[] = [];
      const fotos: Record<string, unknown>[] = [];
      const fallidas: string[] = [];
      for (const [indice, archivo] of entran.entries()) {
        const subida = await subirAlCubo(archivo);
        if (!subida) { fallidas.push(archivo.name); continue; }
        // El id se pone aquí para saber a qué publicación va cada foto sin
        // depender del orden en que la base devuelva lo insertado.
        const id = crypto.randomUUID();
        nuevos.push({ id, business_unit_id: unidadId, network: canal, position: base + indice });
        fotos.push({ post_id: id, image_path: subida.path, file_name: subida.fileName, position: 0 });
      }
      if (nuevos.length > 0) {
        const { error } = await supabase.from("social_posts").insert(nuevos);
        if (error) throw error;
        const { error: errorFotos } = await supabase.from("social_post_images").insert(fotos);
        if (errorFotos) throw errorFotos;
      }
      await cargarPosts(unidadId, canal);
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

  /** Más fotos a una publicación que ya existe: eso es un carrusel. */
  async function anadirAlCarrusel(lista: FileList | null | undefined) {
    if (!abierto) return;
    const imagenes = soloImagenes(lista);
    if (imagenes.length === 0) return;
    setBusy(true);
    try {
      const supabase = createClient();
      const desde = (posts.find((post) => post.id === abierto.id)?.imagenes.length) ?? abierto.imagenes.length;
      const fotos: Record<string, unknown>[] = [];
      for (const [indice, archivo] of imagenes.entries()) {
        const subida = await subirAlCubo(archivo);
        if (!subida) continue;
        fotos.push({ post_id: abierto.id, image_path: subida.path, file_name: subida.fileName, position: desde + indice });
      }
      if (fotos.length === 0) throw new Error("Sin fotos");
      const { error } = await supabase.from("social_post_images").insert(fotos);
      if (error) throw error;
      await cargarPosts(unidadId, canal);
      setAviso(fotos.length === 1 ? "Foto añadida al carrusel." : `${fotos.length} fotos añadidas al carrusel.`);
    } catch (causa) {
      setAviso(reportSafeError(causa, "No se pudieron añadir las fotos al carrusel."));
    } finally {
      setBusy(false);
    }
  }

  async function quitarDelCarrusel(imagen: Imagen) {
    setBusy(true);
    try {
      const supabase = createClient();
      await writeRows(
        supabase.from("social_post_images").delete().eq("id", imagen.id),
        "No se pudo quitar la foto. Comprueba que tu rol permite cambiar las publicaciones.",
      );
      await supabase.storage.from(CUBO).remove([imagen.path]);
      setImagenActiva(0);
      await cargarPosts(unidadId, canal);
    } catch (causa) {
      setAviso(reportSafeError(causa, "No se pudo quitar la foto del carrusel."));
    } finally {
      setBusy(false);
    }
  }

  /** Cambia una foto de sitio dentro del carrusel; la primera es la del perfil. */
  async function moverEnCarrusel(imagenes: Imagen[], indice: number, hacia: -1 | 1) {
    const destino = indice + hacia;
    if (destino < 0 || destino >= imagenes.length) return;
    const orden = [...imagenes];
    [orden[indice], orden[destino]] = [orden[destino], orden[indice]];
    setBusy(true);
    try {
      const supabase = createClient();
      for (const [posicion, imagen] of orden.entries()) {
        await writeRows(
          supabase.from("social_post_images").update({ position: posicion }).eq("id", imagen.id),
          "No se pudo guardar el orden del carrusel.",
        );
      }
      setImagenActiva(destino);
      await cargarPosts(unidadId, canal);
    } catch (causa) {
      setAviso(reportSafeError(causa, "No se pudo cambiar el orden del carrusel."));
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
   * mismas publicaciones en otro orden, así que solo se escriben las que se
   * mueven de sitio: arrastrar una foto no reescribe el feed entero.
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
      await cargarPosts(unidadId, canal).catch(() => undefined);
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
      // Las redes sin texto no se guardan: un hueco vacío no es un dato.
      const limpios = Object.fromEntries(
        Object.entries(borrador.captions).map(([red, texto]) => [red, texto.trim()]).filter(([, texto]) => texto !== ""),
      );
      await writeRows(
        createClient().from("social_posts").update({ captions: limpios, status: borrador.status }).eq("id", abierto.id),
        "No se pudo guardar: puede que alguien haya borrado la publicación o que tu rol no permita cambiarla.",
      );
      setPosts((actuales) => actuales.map((item) => item.id === abierto.id ? { ...item, captions: limpios, status: borrador.status } : item));
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
      // Primero la ficha: si se fueran antes las fotos, quedarían huecos rotos.
      await writeRows(
        supabase.from("social_posts").delete().eq("id", borrando.id),
        "No se pudo eliminar. Comprueba que tu rol permite borrar publicaciones.",
      );
      if (borrando.imagenes.length > 0) await supabase.storage.from(CUBO).remove(borrando.imagenes.map((imagen) => imagen.path));
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

  /** `03.jpg` si va sola; `03-1.jpg`, `03-2.jpg`… si es un carrusel. */
  const nombreDeArchivo = (posicion: number, indice: number, deCuantas: number) =>
    `${String(posicion + 1).padStart(2, "0")}${deCuantas > 1 ? `-${indice + 1}` : ""}.jpg`;

  const textoDe = (post: Post, posicion: number) => redesDelCanal
    .filter((red) => (post.captions[red] ?? "").trim())
    .map((red) => `${String(posicion + 1).padStart(2, "0")} · ${socialNetworkLabels[red]}\n${post.captions[red].trim()}\n`)
    .join("\n");

  function bajar(contenido: Blob, nombre: string) {
    const url = URL.createObjectURL(contenido);
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = nombre;
    enlace.click();
    URL.revokeObjectURL(url);
  }

  async function empaquetar(elegidas: { post: Post; posicion: number }[], nombreZip: string) {
    const archivos: Record<string, Uint8Array> = {};
    const textos: string[] = [];
    const fallidas: string[] = [];
    let hechas = 0;
    const total = elegidas.reduce((suma, { post }) => suma + post.imagenes.length, 0);
    for (const { post, posicion } of elegidas) {
      for (const [indice, imagen] of post.imagenes.entries()) {
        setPreparando(`${hechas} de ${total}`);
        hechas++;
        if (!imagen.url) { fallidas.push(imagen.fileName ?? "una foto"); continue; }
        archivos[nombreDeArchivo(posicion, indice, post.imagenes.length)] = new Uint8Array(await (await recortar(imagen.url)).arrayBuffer());
      }
      const texto = textoDe(post, posicion);
      if (texto) textos.push(texto);
    }
    if (textos.length > 0) archivos["textos.txt"] = new TextEncoder().encode(textos.join("\n"));
    if (Object.keys(archivos).length === 0) throw new Error("Sin archivos");
    // El zip se carga solo cuando hace falta, no al abrir la pantalla.
    const { zipSync } = await import("fflate");
    // Nivel 0: un JPEG ya viene comprimido, apretarlo otra vez solo tarda.
    const zip = zipSync(archivos, { level: 0 });
    bajar(new Blob([zip as BlobPart], { type: "application/zip" }), nombreZip);
    return { fallidas, fotos: Object.keys(archivos).filter((nombre) => nombre.endsWith(".jpg")).length };
  }

  const nombreBase = () => `${unidad?.slug ?? "posts"}-${canal}-${formato.replace(":", "x")}-${new Date().toISOString().slice(0, 10)}`;

  /** Una sola: la foto si va sola, y un zip si es un carrusel. */
  async function descargar(post: Post) {
    const posicion = posts.findIndex((item) => item.id === post.id);
    setBusy(true);
    try {
      if (post.imagenes.length === 1) {
        const imagen = post.imagenes[0];
        if (!imagen.url) throw new Error("Sin foto");
        bajar(await recortar(imagen.url), `${unidad?.slug ?? "post"}-${formato.replace(":", "x")}-${(imagen.fileName ?? "foto").replace(/\.[^.]+$/, "")}.jpg`);
      } else {
        await empaquetar([{ post, posicion: Math.max(posicion, 0) }], `${nombreBase()}-carrusel.zip`);
      }
    } catch (causa) {
      setAviso(reportSafeError(causa, "No se pudo preparar la descarga."));
    } finally {
      setPreparando(null);
      setBusy(false);
    }
  }

  /**
   * Varias de golpe, en un zip. Van numeradas en el orden del feed, que es el
   * orden en que hay que subirlas, y los textos van aparte con los mismos
   * números: copiar ocho copys a mano uno por uno era justo lo que había que
   * evitar.
   */
  async function descargarSeleccionadas() {
    const elegidas = posts.map((post, posicion) => ({ post, posicion })).filter(({ post }) => seleccion.includes(post.id));
    if (elegidas.length === 0) return;
    setPreparando(`0 de ${elegidas.length}`);
    try {
      const { fallidas, fotos } = await empaquetar(elegidas, `${nombreBase()}.zip`);
      setAviso(fallidas.length > 0
        ? `Descargadas ${fotos}; ${fallidas.length} no se pudieron preparar.`
        : `${fotos} ${fotos === 1 ? "foto descargada" : "fotos descargadas"} en un zip.`);
    } catch (causa) {
      setAviso(reportSafeError(causa, "No se pudo preparar la descarga."));
    } finally {
      setPreparando(null);
    }
  }

  async function copiarCopy(texto: string) {
    if (!texto.trim()) { setAviso("Esta publicación todavía no tiene texto en esa red."); return; }
    try {
      await navigator.clipboard.writeText(texto);
      setAviso("Texto copiado: ya lo puedes pegar.");
    } catch {
      setAviso("El navegador no ha dejado copiar. Selecciónalo a mano desde la ficha.");
    }
  }

  function alternarSeleccion(id: string) {
    setSeleccion((actual) => actual.includes(id) ? actual.filter((item) => item !== id) : [...actual, id]);
  }

  function salirDeSeleccion() {
    setSeleccionando(false);
    setSeleccion([]);
  }

  function abrirFicha(post: Post) {
    setAbierto(post);
    setBorrador({ captions: { ...post.captions }, status: post.status });
    setRedActiva(redesDelCanal[0]);
    setImagenActiva(0);
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
  // La ficha abierta, pero con los datos recién cargados (fotos incluidas).
  const ficha = abierto ? posts.find((post) => post.id === abierto.id) ?? abierto : null;
  const imagenes = ficha?.imagenes ?? [];
  const indiceActivo = Math.min(imagenActiva, Math.max(imagenes.length - 1, 0));
  const imagen = imagenes[indiceActivo] ?? null;

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
              ? "Arrastra aquí las fotos o pulsa «Añadir fotos». Pulsa una para escribir su texto, juntarla con otras en un carrusel, descargarla recortada o marcarla como subida."
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
              <span>Dónde se publica</span>
              <select value={canal} onChange={(event) => { setPosts([]); salirDeSeleccion(); setCanal(event.target.value as Canal); }}>
                {CANALES.map((item) => <option key={item.canal} value={item.canal}>{item.etiqueta}</option>)}
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
            <h2>{canal === "instagram" ? "Así quedaría el perfil" : "Preparado para LinkedIn"}</h2>
            <p className="panel-subtitle">
              Arrastra una foto sobre otra para cambiar el orden, o usa las flechas. Instagram recorta en 4:5 por el
              centro: lo que se ve aquí es lo que se verá allí.
            </p>
          </div>
          <div className="feed-switches">
            {posts.length > 0 ? (
              <button
                type="button"
                className={seleccionando ? "button button-compact button-primary" : "button button-compact button-secondary"}
                onClick={() => (seleccionando ? salirDeSeleccion() : setSeleccionando(true))}
              >
                {seleccionando ? "Salir de seleccionar" : "Seleccionar varias"}
              </button>
            ) : null}
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
              <span>Formato</span>
              <select value={formato} onChange={(event) => setFormato(event.target.value as Formato)}>
                <option value="4:5">4:5, como Instagram</option>
                <option value="1:1">1:1, cuadrado</option>
              </select>
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
            <small className="muted">Van numeradas en el orden del feed, y con sus textos en un archivo aparte.</small>
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
            {canal === "instagram" ? (
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
              {posts.map((post, posicion) => {
                const portada = post.imagenes[0] ?? null;
                const conTexto = redesDelCanal.some((red) => (post.captions[red] ?? "").trim());
                return (
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
                      aria-label={seleccionando ? "Seleccionar la publicación" : "Abrir la publicación"}
                      aria-pressed={seleccionando ? seleccion.includes(post.id) : undefined}
                    >
                      {portada?.url
                        /* eslint-disable-next-line @next/next/no-img-element -- firmada por Supabase, no hay nada que optimizar */
                        ? <img src={portada.url} alt={portada.fileName ?? "Publicación preparada"} />
                        : <span className="feed-ilegible">No se pudo cargar esta foto</span>}
                      {seleccionando ? <span className={seleccion.includes(post.id) ? "feed-marca is-on" : "feed-marca"} aria-hidden="true">{seleccion.includes(post.id) ? "✓" : ""}</span> : null}
                      {post.status === "pendiente" ? <span className="feed-tag">Por subir</span> : null}
                      {post.imagenes.length > 1 && !seleccionando ? <span className="feed-tag feed-tag-carrusel" title={`Carrusel de ${post.imagenes.length} fotos`}>❏ {post.imagenes.length}</span> : null}
                      {conTexto && post.imagenes.length <= 1 && !seleccionando ? <span className="feed-tag feed-tag-copy" title="Tiene texto escrito">✎</span> : null}
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
                );
              })}
            </div>
          </div>
        )}
      </section>

      <Modal open={Boolean(ficha)} title="Publicación" eyebrow={unidad?.name ?? ""} onClose={() => setAbierto(null)} large scrollInside>
        {ficha ? (
          <div className="post-ficha">
            <div className="post-ficha-fotos">
              <button
                type="button"
                className={formato === "1:1" ? "post-ficha-foto is-square" : "post-ficha-foto"}
                onClick={() => setAmpliada(indiceActivo)}
                title="Ver la foto entera"
              >
                {imagen?.url
                  /* eslint-disable-next-line @next/next/no-img-element -- firmada por Supabase */
                  ? <img src={imagen.url} alt={imagen.fileName ?? "Publicación preparada"} />
                  : <span className="feed-ilegible">No se pudo cargar esta foto</span>}
                <span className="post-ficha-ampliar">Ver entera</span>
              </button>
              <div className="post-ficha-tira">
                {imagenes.map((item, indice) => (
                  <button
                    key={item.id}
                    type="button"
                    className={indice === indiceActivo ? "post-ficha-mini is-on" : "post-ficha-mini"}
                    onClick={() => setImagenActiva(indice)}
                    aria-label={`Ver la foto ${indice + 1} de ${imagenes.length}`}
                  >
                    {item.url
                      /* eslint-disable-next-line @next/next/no-img-element -- firmada por Supabase */
                      ? <img src={item.url} alt="" />
                      : <span className="feed-ilegible">?</span>}
                    <i aria-hidden="true">{indice + 1}</i>
                  </button>
                ))}
                {canEdit ? (
                  <>
                    <input
                      ref={entradaCarruselRef}
                      type="file"
                      accept="image/*"
                      multiple
                      hidden
                      onChange={(event) => { void anadirAlCarrusel(event.target.files); event.target.value = ""; }}
                    />
                    <button type="button" className="post-ficha-mini post-ficha-mas" disabled={busy} onClick={() => entradaCarruselRef.current?.click()} title="Añadir fotos al carrusel">+</button>
                  </>
                ) : null}
              </div>
              {canEdit && imagenes.length > 1 ? (
                <div className="post-ficha-orden">
                  <button type="button" className="button button-compact button-secondary" disabled={busy || indiceActivo === 0} onClick={() => void moverEnCarrusel(imagenes, indiceActivo, -1)}>← Antes</button>
                  <button type="button" className="button button-compact button-secondary" disabled={busy || indiceActivo >= imagenes.length - 1} onClick={() => void moverEnCarrusel(imagenes, indiceActivo, 1)}>Después →</button>
                  <button type="button" className="button button-compact button-secondary" disabled={busy} onClick={() => imagen && void quitarDelCarrusel(imagen)}>Quitar esta</button>
                </div>
              ) : null}
              <small className="muted">
                {imagenes.length > 1
                  ? `Carrusel de ${imagenes.length} fotos. En el perfil solo se ve la primera.`
                  : canEdit ? "Pulsa + para juntarla con otras en un carrusel." : ""}
              </small>
            </div>

            <div className="post-ficha-datos">
              {redesDelCanal.length > 1 ? (
                <div className="post-ficha-redes" role="tablist" aria-label="Texto por red">
                  {redesDelCanal.map((red) => (
                    <button
                      key={red}
                      type="button"
                      role="tab"
                      aria-selected={red === redActiva}
                      className={red === redActiva ? "post-ficha-red is-on" : "post-ficha-red"}
                      onClick={() => setRedActiva(red)}
                    >
                      {socialNetworkLabels[red]}
                      {(borrador.captions[red] ?? "").trim() ? <i aria-hidden="true">•</i> : null}
                    </button>
                  ))}
                </div>
              ) : null}
              <label>
                <span>Texto para {socialNetworkLabels[redActiva]}</span>
                <textarea
                  rows={9}
                  maxLength={MAXIMO_COPY}
                  value={borrador.captions[redActiva] ?? ""}
                  readOnly={!canEdit}
                  placeholder={`El copy que irá en ${socialNetworkLabels[redActiva]}…`}
                  onChange={(event) => setBorrador((actual) => ({ ...actual, captions: { ...actual.captions, [redActiva]: event.target.value } }))}
                />
              </label>
              <small className="muted">
                {(borrador.captions[redActiva] ?? "").length} de {MAXIMO_COPY} caracteres
                {imagen?.fileName ? ` · ${imagen.fileName}` : ""}
              </small>
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
                <button type="button" className="button button-secondary" disabled={busy || preparando !== null} onClick={() => void descargar(ficha)}>
                  {preparando ? `Preparando… ${preparando}` : imagenes.length > 1 ? `Descargar las ${imagenes.length} en ${formato}` : `Descargar en ${formato}`}
                </button>
                <button type="button" className="button button-secondary" onClick={() => void copiarCopy(borrador.captions[redActiva] ?? "")}>
                  Copiar texto de {socialNetworkLabels[redActiva]}
                </button>
                {canEdit ? <button type="button" className="button button-secondary" onClick={() => setBorrando(ficha)}>Eliminar</button> : null}
              </div>
            </div>
          </div>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={() => setAbierto(null)}>Cerrar</button>
          {canEdit ? <button type="button" className="button button-primary" disabled={busy} onClick={() => void guardarFicha()}>{busy ? "Guardando…" : "Guardar"}</button> : null}
        </div>
      </Modal>

      {ampliada !== null && imagenes[ampliada] ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setAmpliada(null)}>
          <div className="attachment-lightbox" onClick={(event) => event.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element -- firmada por Supabase */}
            <img src={imagenes[ampliada].url ?? ""} alt={imagenes[ampliada].fileName ?? "Publicación preparada"} />
            <div className="attachment-lightbox-actions">
              {imagenes.length > 1 ? (
                <>
                  <button type="button" className="button button-secondary" onClick={() => setAmpliada((actual) => actual === null ? null : (actual - 1 + imagenes.length) % imagenes.length)}>‹ Anterior</button>
                  <span className="muted">{ampliada + 1} de {imagenes.length}</span>
                  <button type="button" className="button button-secondary" onClick={() => setAmpliada((actual) => actual === null ? null : (actual + 1) % imagenes.length)}>Siguiente ›</button>
                </>
              ) : null}
              <button type="button" className="button button-secondary" onClick={() => setAmpliada(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmationDialog
        open={Boolean(borrando)}
        title="Eliminar la publicación"
        confirmLabel="Eliminar"
        busy={busy}
        onCancel={() => setBorrando(null)}
        onConfirm={() => void confirmarBorrado()}
      >
        <div className="confirmation-summary">
          <span>Publicación</span><strong>{borrando?.imagenes[0]?.fileName ?? "Sin nombre"}</strong>
          <span>Efecto</span>
          <strong>
            {borrando && borrando.imagenes.length > 1
              ? `Se borran sus ${borrando.imagenes.length} fotos y su texto. No se puede deshacer.`
              : "Se borra la foto y su texto. No se puede deshacer."}
          </strong>
        </div>
      </ConfirmationDialog>
    </div>
  );
}
