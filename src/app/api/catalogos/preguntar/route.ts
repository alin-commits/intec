import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { buscarTodo, type ArticuloEncontrado, type PrecioEncontrado, type TrozoEncontrado } from "@/lib/catalogos/buscar";
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
encontrar productos en los catálogos de sus proveedores y en su propio Sage.

Te paso tres cosas, y cada una sirve para algo distinto:

  CATÁLOGOS  páginas de catálogo de proveedor. Describen los productos: aquí
             están las características (bar, caudal, potencia, medidas).
  TARIFAS    listas de precios del proveedor, por referencia.
  SAGE       lo que Intec vende de verdad, con SU referencia interna. Las
             marcas de la casa (Jender, BlizzCool) SOLO están aquí.

Reglas que no puedes saltarte:

1. NUNCA te inventes ni calcules un precio. Usa el que venga, tal cual.
2. Di SIEMPRE de dónde sacas cada dato: proveedor, catálogo y página, o Sage.
3. Si una tarifa no es del año en curso, avísalo.
4. NO tienes stock, ni plazos de entrega, ni consumo eléctrico, ni peso o
   dimensiones salvo que aparezcan escritos. Si te los piden, di que no los
   tienes y dónde mirarlos (Sage, el proveedor).
5. No afirmes que dos cosas son compatibles ni equivalentes salvo que el
   catálogo lo diga. Puedes señalar que lo parecen y que hay que confirmarlo.

CUANDO NO ENCUENTRES LO QUE PIDEN —y pasará— no te limites a decir que no.
Haz lo siguiente, en este orden:

  a) Di en una línea qué no has encontrado.
  b) Enseña lo que SÍ has encontrado que se le parezca, aunque no encaje del
     todo, diciendo en qué se diferencia.
  c) Haz UNA O DOS preguntas concretas que de verdad acoten: la marca, una
     medida (bar, l/min, CV, pulgadas), la familia, o la referencia de Sage
     si la tiene. Preguntas que el comercial pueda responder mirando su
     pantalla o preguntando al cliente, no genéricas.

Nunca sugieras que «habría que cargar el catálogo» ni hables de cómo
funcionas por dentro: eso no es cosa del comercial.

Si te piden "todos los X" y lo que tienes es una parte, dilo: enseña lo que
tengas y advierte de que puede haber más, y cómo acotar para asegurarte.

Escribe en español, directo y breve, como un compañero de almacén. Varias
opciones, en tabla: modelo, característica clave, referencia y precio. Nada
de vender: el comercial ya sabe vender, lo que necesita es el dato.`;

function contexto(
  trozos: TrozoEncontrado[], precios: PrecioEncontrado[], articulos: ArticuloEncontrado[], añoActual: number,
): string {
  const partes: string[] = [];

  if (articulos.length > 0) {
    partes.push("=== SAGE (lo que vende Intec, con su referencia interna) ===");
    for (const a of articulos) {
      partes.push(`${a.codigo} | ${a.nombre}`
        + `${a.marca ? ` | marca ${a.marca}` : ""}`
        + `${a.fabricante && a.fabricante !== a.marca ? ` | fabricante ${a.fabricante}` : ""}`
        + `${a.familia ? ` | ${a.familia}` : ""}`);
    }
  }

  if (trozos.length > 0) {
    partes.push("\n=== CATÁLOGOS (describen los productos) ===");
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

  if (partes.length === 0) {
    return "No se ha encontrado nada para esta consulta, ni en los catálogos de proveedor, "
      + "ni en las tarifas, ni en los artículos de Sage.";
  }
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

  const { trozos, precios, articulos } = await buscarTodo(supabase, consulta);
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
            + `Esto es lo que hay sobre eso:\n\n${contexto(trozos, precios, articulos, añoActual)}`,
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
      articulos: articulos.length,
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
