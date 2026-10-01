import { redirect } from "next/navigation";

// Pagos es ya una pestaña de Administración: los enlaces antiguos llevan ahí.
export default function PaymentsPage() {
  redirect("/administracion?p=remesas");
}
