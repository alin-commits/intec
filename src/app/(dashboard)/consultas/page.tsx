import { Suspense } from "react";
import { InquiryRegister } from "@/components/inquiry-register";

// Lee la dirección (para abrir una consulta por su enlace), y eso pide un
// Suspense alrededor, igual que la página de leads.
export default function InquiriesPage() {
  return (
    <Suspense>
      <InquiryRegister />
    </Suspense>
  );
}
