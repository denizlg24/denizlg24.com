import { useLocalSearchParams } from "expo-router";
import { TriageDetail } from "@/features/inbox/triage-detail";

export default function Triage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TriageDetail id={id} />;
}
