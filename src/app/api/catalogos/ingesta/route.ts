import { NextResponse } from "next/server";
import { z } from "zod";
import { isSageAgent } from "@/lib/sage-agent-auth";
import { createAdminClient } from "@/lib/supabase/admin";

/*
  Por aquí entra el texto de los catálogos.

  Quien llama es el agente de catálogos, que corre en el mismo servidor que el
  de Sage y se identifica con la misma clave: son el mismo programa de la misma
  máquina a efectos de confianza, y una clave más solo sería una cosa más que
  caducar.

  Lo que llega no son ficheros. En la carpeta hay 2,7 GB y un PDF de 376 MB; lo
  que sube es el texto ya extraído, que son unos 40 MB en total. Vercel corta a
  4,5 MB por petición, así que un catálogo grande llega en varias partes:

    parte 1   se apunta el fichero y se borra lo que hubiera de la vez anterior
    partes n  van entrando los trozos y los precios
    última    se marca la fecha de lectura

  El borrado va en la primera parte y no al final a propósito: si una lectura se
  corta por la mitad, lo que queda es un catálogo incompleto pero coherente, y
  la siguiente pasada lo repite entero. Al revés —borrar al final— un corte
  dejaría el texto viejo y el nuevo mezclados, que es mucho peor de detectar.
*/

export const maxDuration = 120;

const texto = (max: number) => z.string().trim().max(max);

const cuerpo = z.object({
  fichero: z.object({
    supplier: texto(120),
    file_name: texto(300),
    rel_path: texto(600),
    kind: texto(12),
    bytes: z.number().int().nonnegative().nullable().default(null),
    modified_at: z.string().datetime({ offset: true }).nullable().default(null),
    content_hash: texto(120).nullable().default(null),
    pages: z.number().int().nonnegative().nullable().default(null),
    year_hint: z.number().int().min(1990).max(2100).nullable().default(null),
    read_error: texto(500).nullable().default(null),
  }),
  parte: z.number().int().positive().default(1),
  ultima: z.boolean().default(true),
  chunks: z.array(z.object({
    page: z.number().int().nonnegative().nullable().default(null),
    ordinal: z.number().int().nonnegative(),
    content: z.string().min(1).max(20000),
  })).max(4000).default([]),
  precios: z.array(z.object({
    reference: texto(120).nullable().default(null),
    ean: texto(40).nullable().default(null),
    description: texto(600).nullable().default(null),
    price: z.number().finite().nullable().default(null),
    currency: texto(8).default("EUR"),
    unit: texto(40).nullable().default(null),
    raw: z.record(z.string(), z.unknown()).nullable().default(null),
  })).max(5000).default([]),
});

export async function POST(request: Request) {
  if (!isSageAgent(request)) return NextResponse.json({ error: "no autorizado" }, { status: 401 });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "falta la configuración de Supabase" }, { status: 500 });

  let datos: z.infer<typeof cuerpo>;
  try {
    datos = cuerpo.parse(await request.json());
  } catch (fallo) {
    const detalle = fallo instanceof z.ZodError ? fallo.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join(" · ") : "cuerpo ilegible";
    return NextResponse.json({ error: `envío mal formado — ${detalle}` }, { status: 400 });
  }

  const { fichero, parte, ultima, chunks, precios } = datos;

  // El fichero: se apunta siempre, aunque no se haya podido leer. Un catálogo
  // que falla tiene que verse en la lista con su motivo, no desaparecer.
  const { data: guardado, error: errorFichero } = await admin
    .from("catalog_files")
    .upsert({
      supplier: fichero.supplier,
      file_name: fichero.file_name,
      rel_path: fichero.rel_path,
      kind: fichero.kind,
      bytes: fichero.bytes,
      modified_at: fichero.modified_at,
      content_hash: fichero.content_hash,
      pages: fichero.pages,
      year_hint: fichero.year_hint,
      read_error: fichero.read_error,
      read_at: ultima && !fichero.read_error ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "rel_path" })
    .select("id")
    .single();

  if (errorFichero || !guardado) {
    console.error("Catálogos: no se pudo apuntar el fichero", errorFichero);
    return NextResponse.json({ error: "no se pudo guardar el fichero" }, { status: 500 });
  }

  // Lo de la vez anterior se va en la primera parte, no al final: ver arriba.
  if (parte === 1) {
    const [borradoTrozos, borradoPrecios] = await Promise.all([
      admin.from("catalog_chunks").delete().eq("file_id", guardado.id),
      admin.from("catalog_prices").delete().eq("file_id", guardado.id),
    ]);
    const fallo = borradoTrozos.error ?? borradoPrecios.error;
    if (fallo) {
      console.error("Catálogos: no se pudo limpiar lo anterior", fallo);
      return NextResponse.json({ error: "no se pudo limpiar la lectura anterior" }, { status: 500 });
    }
  }

  if (chunks.length > 0) {
    const { error } = await admin.from("catalog_chunks")
      .insert(chunks.map((t) => ({ file_id: guardado.id, page: t.page, ordinal: t.ordinal, content: t.content })));
    if (error) {
      console.error("Catálogos: no se pudieron guardar los trozos", error);
      return NextResponse.json({ error: "no se pudieron guardar los trozos" }, { status: 500 });
    }
  }

  if (precios.length > 0) {
    const { error } = await admin.from("catalog_prices")
      .insert(precios.map((p) => ({ file_id: guardado.id, supplier: fichero.supplier, ...p })));
    if (error) {
      console.error("Catálogos: no se pudieron guardar los precios", error);
      return NextResponse.json({ error: "no se pudieron guardar los precios" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, fileId: guardado.id, trozos: chunks.length, precios: precios.length });
}

/*
  Qué hay ya leído, para que el agente no vuelva a leer lo que no ha cambiado.

  Devuelve la ruta y el hash de cada fichero. El agente compara y se salta los
  que coinciden: en una pasada normal eso es casi todo, porque una tarifa se
  cambia una vez al año.
*/
export async function GET(request: Request) {
  if (!isSageAgent(request)) return NextResponse.json({ error: "no autorizado" }, { status: 401 });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "falta la configuración de Supabase" }, { status: 500 });

  const { data, error } = await admin.from("catalog_files").select("rel_path, content_hash, read_at, read_error");
  if (error) {
    console.error("Catálogos: no se pudo leer lo ya guardado", error);
    return NextResponse.json({ error: "no se pudo consultar" }, { status: 500 });
  }

  return NextResponse.json({
    // Solo cuenta como leído lo que terminó bien: si quedó a medias o dio
    // error, el agente tiene que volver a intentarlo.
    leidos: Object.fromEntries((data ?? [])
      .filter((f) => f.read_at && !f.read_error)
      .map((f) => [f.rel_path, f.content_hash])),
  });
}
