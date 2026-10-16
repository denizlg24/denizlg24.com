import { useLocalSearchParams } from "expo-router";
import { ContactDetail } from "@/features/inbox/contact-detail";

export default function Contact() {
  const { ticketId } = useLocalSearchParams<{ ticketId: string }>();
  return <ContactDetail ticketId={ticketId} />;
}
