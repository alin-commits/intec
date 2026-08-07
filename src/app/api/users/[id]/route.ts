import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const HISTORY_BLOCKED_MESSAGE = "No se puede eliminar: este usuario tiene consultas, leads, campañas o ventas registradas a su nombre. Desactívalo en su lugar para conservar el historial.";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    if (!supabase) return NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

    const { data: currentProfile } = await supabase.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle();
    if (!currentProfile || currentProfile.role !== "admin" || !currentProfile.is_active) {
      return NextResponse.json({ error: "Solo un administrador puede eliminar usuarios." }, { status: 403 });
    }

    if (id === user.id) {
      return NextResponse.json({ error: "No puedes eliminar tu propia cuenta." }, { status: 400 });
    }

    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY en Vercel." }, { status: 503 });

    // These tables restrict deleting a referenced profile, and Supabase's
    // admin API surfaces that as an opaque 500 with no usable message — so
    // check up front and fail with a clear reason instead of guessing.
    const [inquiries, leads, campaigns, sales] = await Promise.all([
      admin.from("inquiries").select("id", { count: "exact", head: true }).eq("created_by", id),
      admin.from("leads").select("id", { count: "exact", head: true }).eq("created_by", id),
      admin.from("campaigns").select("id", { count: "exact", head: true }).eq("created_by", id),
      admin.from("sales_entries").select("id", { count: "exact", head: true }).eq("created_by", id),
    ]);
    const hasHistory = [inquiries, leads, campaigns, sales].some((result) => (result.count ?? 0) > 0);
    if (hasHistory) {
      return NextResponse.json({ error: HISTORY_BLOCKED_MESSAGE }, { status: 409 });
    }

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
