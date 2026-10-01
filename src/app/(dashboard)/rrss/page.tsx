import { redirect } from "next/navigation";

// RRSS es ya parte de Marketing: los enlaces antiguos llevan ahí.
export default function RrssPage() {
  redirect("/marketing?p=redes");
}
