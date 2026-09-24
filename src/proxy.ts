import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
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
  /**
   * Rutas que no atienden a una persona sino a un programa, y que por tanto no
   * pueden tener sesión: comprueban ellas mismas una clave compartida. Van por
   * ruta exacta y no por prefijo, para que una ruta nueva bajo el mismo camino
   * no quede abierta sin querer.
   */
  const machinePaths = ["/api/sage/ingest"];
  const isLogin = request.nextUrl.pathname.startsWith("/login");
  const isPublicPath = request.nextUrl.pathname === "/"
    || machinePaths.includes(request.nextUrl.pathname)
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
