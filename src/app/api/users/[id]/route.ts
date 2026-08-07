import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    if (!supabase) return NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

    const { data: currentProfile } = await supabase.from("profiles").select("roles, is_active").eq("id", user.id).maybeSingle();
    if (!currentProfile || !currentProfile.roles.includes("admin") || !currentProfile.is_active) {
      return NextResponse.json({ error: "Solo un administrador puede eliminar usuarios." }, { status: 403 });
    }

    if (id === user.id) {
      return NextResponse.json({ error: "No puedes eliminar tu propia cuenta." }, { status: 400 });
    }

    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY en Vercel." }, { status: 503 });

    // Consultas, leads, campañas y ventas son datos compartidos por todo el
    // equipo comercial, no propiedad exclusiva de quien los creó — created_by
    // se limpia a NULL (ON DELETE SET NULL) en vez de bloquear el borrado.
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      console.error("Error al eliminar usuario:", error);
      return NextResponse.json({ error: "No se pudo eliminar el usuario." }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (cause) {
    console.error("Error inesperado en /api/users/[id] DELETE:", cause);
    return NextResponse.json({ error: "No se pudo eliminar el usuario. Inténtalo de nuevo." }, { status: 500 });
  }
}
