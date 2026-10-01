import { redirect } from "next/navigation";

// Campañas es ya parte de Marketing: los enlaces antiguos llevan ahí.
export default function CampaignsPage() {
  redirect("/marketing?p=campanas");
}
