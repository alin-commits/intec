import { AdministrationDepartment } from "@/components/admin/administration-department";

export default async function AdministracionPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { p } = await searchParams;
  return <AdministrationDepartment initial={typeof p === "string" ? p : null} />;
}
