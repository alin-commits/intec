import { NextResponse } from "next/server";
import { AGENCIA_EDIT_ROLES, hasAnyRole } from "@/lib/constants";
import { leerPresupuesto, lectorConfigurado, type DocumentoDePresupuesto } from "@/lib/agencia-lector-ia";
import { todayKey } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { xlsxATexto } from "@/lib/xlsx-a-texto";
import type { AppRole } from "@/lib/types";

/*
  Leer con IA el presupuesto de la agencia.

  Recibe el archivo (PDF, Excel .xlsx o CSV), se lo pasa a Claude y devuelve
  las partidas propuestas. No guarda nada: las revisa quien lo sube y las
  guarda él desde la pantalla, como cualquier partida.
*/

// Leer un PDF de varias páginas con el modelo grande lleva su rato.
export const maxDuration = 180;

/** Por debajo del límite de Vercel para lo que entra (4,5 MB). */
const MAXIMO_BYTES = 4 * 1024 * 1024;

const empiezaPor = (bytes: Uint8Array, firma: number[]) => firma.every((byte, indice) => bytes[indice] === byte);
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP = [0x50, 0x4b, 0x03, 0x04]; // PK: los .xlsx son un zip
const OLE = [0xd0, 0xcf, 0x11, 0xe0]; // el .xls antiguo

/** Un CSV puede venir en UTF-8 o, si sale del Excel de Windows, en Windows-1252. */
function textoDe(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { data: perfil } = await supabase.from("profiles").select("roles, is_active").eq("id", user.id).maybeSingle();
  if (!perfil?.is_active || !hasAnyRole(perfil.roles as AppRole[], AGENCIA_EDIT_ROLES)) {
    return NextResponse.json({ error: "No tienes permiso para cambiar el presupuesto de la agencia." }, { status: 403 });
  }
  if (!lectorConfigurado()) return NextResponse.json({ error: "La IA no está configurada en el servidor." }, { status: 503 });

  let archivo: File;
  try {
    const formulario = await request.formData();
    const campo = formulario.get("archivo");
    if (!(campo instanceof File)) return NextResponse.json({ error: "No ha llegado ningún archivo." }, { status: 400 });
    archivo = campo;
  } catch {
    return NextResponse.json({ error: "No se pudo leer el archivo. Prueba otra vez." }, { status: 400 });
  }
  if (archivo.size === 0) return NextResponse.json({ error: "El archivo está vacío." }, { status: 400 });
  if (archivo.size > MAXIMO_BYTES) return NextResponse.json({ error: "El archivo pasa de 4 MB. Prueba con un PDF más ligero o con el Excel." }, { status: 413 });

  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const nombre = archivo.name.slice(0, 120) || "presupuesto";
  let documento: DocumentoDePresupuesto;
  if (empiezaPor(bytes, PDF)) {
    documento = { tipo: "pdf", base64: Buffer.from(bytes).toString("base64"), nombre };
  } else if (empiezaPor(bytes, ZIP)) {
    try {
      const excel = xlsxATexto(bytes);
      if (excel.celdas === 0) return NextResponse.json({ error: "El Excel no tiene ninguna celda con datos." }, { status: 400 });
      documento = { tipo: "texto", texto: excel.recortado ? `${excel.texto}\n\n(El Excel sigue, pero se ha recortado aquí por largo.)` : excel.texto, nombre };
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo abrir el Excel." }, { status: 400 });
    }
  } else if (empiezaPor(bytes, OLE)) {
    return NextResponse.json({ error: "Es un Excel antiguo (.xls). Ábrelo y guárdalo como .xlsx, o pásalo a PDF." }, { status: 400 });
  } else if (/\.(csv|txt)$/i.test(nombre)) {
    documento = { tipo: "texto", texto: textoDe(bytes).slice(0, 150_000), nombre };
  } else {
    return NextResponse.json({ error: "Solo se leen PDF, Excel (.xlsx) y CSV." }, { status: 400 });
  }

  // Las marcas con las que se lee: las mismas que ve quien lo sube.
  const { data: marcas, error } = await supabase.from("business_units").select("id, name").eq("is_active", true).order("sort_order");
  if (error || !marcas?.length) return NextResponse.json({ error: "No se pudieron cargar las marcas." }, { status: 500 });

  const lectura = await leerPresupuesto({ documento, marcas, hoy: todayKey() });
  if (!lectura.ok) return NextResponse.json({ error: lectura.error }, { status: 502 });
  return NextResponse.json(
    { resumen: lectura.resumen, partidas: lectura.partidas, avisos: lectura.avisos },
    { headers: { "Cache-Control": "no-store" } },
  );
}
