import { Suspense } from "react";
import { CrmManager } from "@/components/crm-manager";

export default function CrmPage() {
  return (
    <Suspense>
      <CrmManager />
    </Suspense>
  );
}
