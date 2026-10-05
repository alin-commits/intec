import { redirect } from "next/navigation";

// El cuadrante es ya una pestaña de Administración: los enlaces antiguos llevan ahí.
export default function HorariosPage() {
  redirect("/administracion?p=horarios");
}
