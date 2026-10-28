import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Rutas que no atienden a una persona sino a un programa, y que por tanto no
 * pueden tener sesión: comprueban ellas mismas una clave compartida. Van por
 * ruta exacta y no por prefijo, para que una ruta nueva bajo el mismo camino
 * no quede abierta sin querer.
 */
const MACHINE_PATHS = ["/api/sage/ingest", "/api/sage/refresh/claim", "/api/sage/refresh/finish", "/api/meta/leads", "/api/catalogos/ingesta"];

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return NextResponse.next({ request });
  }

  /*
    Las rutas que atienden a un programa salen de aquí antes de nada.

    No tienen sesión que mirar —comprueban ellas mismas una clave compartida—,
    así que preguntarle a Supabase quién es el usuario era una llamada de red
    por cada petición que siempre contestaba «nadie». El agente de Sage manda
    unos 265 envíos al día y pregunta cada minuto si alguien ha pulsado
    «Actualizar»: son unas 44.000 llamadas al mes que no decidían nada.

    Van por ruta exacta, igual que abajo: una ruta nueva bajo el mismo camino
    no se queda abierta sin querer, sigue pasando por la sesión.

    Lo otro que abarata estas rutas no se puede escribir aquí: es
    «skipMiddlewareRequestBody» en vercel.json, que hace que el cuerpo de la
    petición no se copie a este archivo y le llegue solo a la ruta que lo
    atiende. Es seguro porque aquí nunca se lee el cuerpo, únicamente la
    cookie de sesión y la ruta; si algún día hiciera falta leerlo, hay que
    quitar esa opción o el cuerpo llegará vacío.
  */
  if (MACHINE_PATHS.includes(request.nextUrl.pathname)) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  const publicPrefixes = ["/login", "/forgot-password", "/reset-password", "/invitacion", "/soporte", "/tarjeta", "/api/tickets", "/api/auth", "/api/cron"];
  const isLogin = request.nextUrl.pathname.startsWith("/login");
  const isPublicPath = request.nextUrl.pathname === "/"
    || publicPrefixes.some((path) => request.nextUrl.pathname.startsWith(path));

  if (!user && !isPublicPath) {
    // An API call must get a clear "not authorized" instead of the HTML of the
    // login page, which a fetch() would otherwise parse as if it were data.
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "No autorizado.", reason: "signed_out" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  if (user && isLogin) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/dashboard";
    return NextResponse.redirect(dashboardUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
