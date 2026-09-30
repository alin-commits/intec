import { PageLoader } from "@/components/ui/page-loader";

// Mientras llega una página nueva del menú se ve esto, con el menú ya en su
// sitio, en vez de quedarse en la anterior sin saber si el clic ha hecho algo.
export default function Loading() {
  return <PageLoader />;
}
