import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { buscarTodo, type PrecioEncontrado, type TrozoEncontrado } from "@/lib/catalogos/buscar";
import { CATALOGOS_ROLES, hasAnyRole } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";

/*
  El chat de catálogos.

  Lo que hace, por orden: busca en los catálogos y en las tarifas, le pasa al
  modelo solo lo encontrado, y el modelo redacta a partir de eso.

  La regla que no se negocia: los precios no los calcula ni los recuerda el
  modelo, salen de la tabla. Un número inventado acaba en un presupuesto a un
  cliente, y para cuando alguien lo note, ya se ha mandado.

  Por eso el precio va en la respuesta tal como está en la tarifa, con el
  fichero y el año de donde sale. En la carpeta de 2026 hay tarifas de 2022:
  decir de cuándo es cada precio no es un detalle, es la diferencia entre un
  dato y una trampa.
*/

export const maxDuration = 60;

const MODELO = process.env.CATALOGOS_MODELO_IA?.trim() || "claude-sonnet-5-5";

const cuerpo = z.object({
  pregunta: z.string().trim().min(2, "Escribe qué buscas.").max(500),
  // Lo dicho antes, para que «¿y en 10 bar?» se entienda. Se queda corto a
  // propósito: el chat responde consultas, no mantiene una conversación larga.
  anteriores: z.array(z.object({
    de: z.enum(["persona", "chat"]),
    texto: z.string().max(4000),
  })).max(6).default([]),
});

const INSTRUCCIONES = `Ayudas a los comerciales de Intec, una empresa de suministro industrial, a
encontrar productos en los catálogos y tarifas de sus proveedores.

Respondes SOLO con lo que venga en los datos que se te pasan. Si no está ahí, lo dices.

Reglas que no puedes saltarte:

1. NUNCA te inventes ni calcules un precio. Usa exactamente el que venga en
   TARIFAS. Si un producto del catálogo no tiene precio en la lista, dilo:
   "no tengo su precio aquí".
2. Di SIEMPRE de dónde sacas cada dato: el proveedor, el catálogo y la página.
3. Si una tarifa no es del año en curso, avisa de que puede estar desfasada.
4. Si lo que encuentras no cumple del todo lo que piden, dilo claramente en vez
   de ofrecerlo como si cumpliera.
5. Si no encuentras nada que sirva, dilo y sugiere cómo acotar la búsqueda
   (marca, familia, alguna medida). No rellenes con generalidades.

Escribe en español, directo y breve, como hablaría un compañero de almacén. Si
hay varias opciones, ponlas en una tabla con modelo, característica clave,
referencia y precio. Nada de vender: el comercial ya sabe vender, lo que
necesita es el dato.`;

function contexto(trozos: TrozoEncontrado[], precios: PrecioEncontrado[], añoActual: number): string {
  const partes: string[] = [];

  if (trozos.length > 0) {
    partes.push("=== CATÁLOGOS (describen los productos) ===");
    for (const t of trozos) {
      const viejo = t.año && t.año < añoActual ? ` [OJO: catálogo de ${t.año}]` : "";
      partes.push(`\n--- ${t.proveedor} · ${t.fichero}${t.pagina ? ` · página ${t.pagina}` : ""}${viejo}\n${t.texto}`);
    }
  }

  if (precios.length > 0) {
    partes.push("\n=== TARIFAS (los precios, úsalos tal cual) ===");
    for (const p of precios) {
      const viejo = p.año && p.año < añoActual ? ` [OJO: tarifa de ${p.año}]` : "";
      partes.push(`${p.proveedor} | ref ${p.referencia ?? "—"} | ${p.descripcion ?? "—"} | `
        + `${p.precio === null ? "sin precio" : `${p.precio} €`} | ${p.fichero}${viejo}`);
    }
  }

  if (partes.length === 0) return "No se ha encontrado nada en los catálogos para esta consulta.";
  return partes.join("\n");
}

export async function POST(request: Request) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { data: perfil } = await supabase.from("profiles").select("roles, is_active").eq("id", user.id).maybeSingle();
  if (!perfil?.is_active || !hasAnyRole(perfil.roles as AppRole[], CATALOGOS_ROLES)) {
    return NextResponse.json({ error: "No tienes permiso para consultar los catálogos." }, { status: 403 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Falta configurar la clave del modelo." }, { status: 503 });
  }

  let datos: z.infer<typeof cuerpo>;
  try {
    datos = cuerpo.parse(await request.json());
  } catch (fallo) {
    const detalle = fallo instanceof z.ZodError ? fallo.issues[0]?.message : "No se entiende la pregunta.";
    return NextResponse.json({ error: detalle }, { status: 400 });
  }

  // Se busca con la pregunta de ahora más la anterior de la persona: así «¿y
  // en 10 bar?» sigue encontrando compresores y no cualquier cosa de 10 bar.
  const ultimaSuya = [...datos.anteriores].reverse().find((m) => m.de === "persona")?.texto ?? "";
  const consulta = `${ultimaSuya} ${datos.pregunta}`.trim();

  const { trozos, precios } = await buscarTodo(supabase, consulta);
  const añoActual = new Date().getFullYear();

  try {
    const anthropic = new Anthropic();
    const respuesta = await anthropic.messages.create({
      model: MODELO,
      max_tokens: 2000,
      system: INSTRUCCIONES,
      messages: [
        ...datos.anteriores.map((m) => ({
          role: m.de === "persona" ? ("user" as const) : ("assistant" as const),
          content: m.texto,
        })),
        {
          role: "user" as const,
          content: `Pregunta del comercial: ${datos.pregunta}\n\n`
            + `Esto es lo que hay en los catálogos sobre eso:\n\n${contexto(trozos, precios, añoActual)}`,
        },
      ],
    });

    const texto = respuesta.content
      .filter((bloque): bloque is Anthropic.TextBlock => bloque.type === "text")
      .map((bloque) => bloque.text)
      .join("\n")
      .trim();

    return NextResponse.json({
      respuesta: texto || "No he sabido responder a eso. Prueba a decirlo de otra forma.",
      // Lo que se ha mirado, para que el comercial pueda ir a comprobarlo.
      fuentes: trozos.map((t) => ({ proveedor: t.proveedor, fichero: t.fichero, pagina: t.pagina, año: t.año })),
      productos: precios.length,
    });
  } catch (fallo) {
    if (fallo instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "El modelo está saturado ahora mismo. Prueba en un minuto." }, { status: 429 });
    }
    if (fallo instanceof Anthropic.AuthenticationError) {
      console.error("Catálogos: la clave de Anthropic no vale");
      return NextResponse.json({ error: "La clave del modelo no es válida." }, { status: 503 });
    }
    console.error("Catálogos: falló la consulta al modelo", fallo);
    return NextResponse.json({ error: "No se pudo responder. Vuelve a intentarlo." }, { status: 502 });
  }
}
