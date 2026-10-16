import { useLocalSearchParams } from "expo-router";
import { Thread } from "@/features/agent/thread";

export default function ChatThread() {
  const { id, first } = useLocalSearchParams<{ id: string; first?: string }>();
  return <Thread key={id} id={id} firstMessage={first} />;
}
