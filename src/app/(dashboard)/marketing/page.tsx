import { MarketingDepartment } from "@/components/marketing-department";

export default async function MarketingPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { p } = await searchParams;
  return <MarketingDepartment initial={typeof p === "string" ? p : null} />;
}
