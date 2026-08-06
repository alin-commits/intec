import { TicketDetailManager } from "@/components/tickets/ticket-detail-manager";

type TicketDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function TicketDetailPage({ params }: TicketDetailPageProps) {
  const { id } = await params;
  return <TicketDetailManager ticketId={id} />;
}
