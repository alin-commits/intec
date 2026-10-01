import { redirect } from "next/navigation";

// Gastos de marketing es ya una pestaña de Marketing: los enlaces antiguos llevan ahí.
export default function ExpensesPage() {
  redirect("/marketing?p=gastos");
}
