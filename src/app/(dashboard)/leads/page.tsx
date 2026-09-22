import { Suspense } from "react";
import { LeadsTable } from "@/components/leads-table";

export default function LeadsPage() {
  return (
    <Suspense>
      <LeadsTable />
    </Suspense>
  );
}
