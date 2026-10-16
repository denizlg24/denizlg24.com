import { useLocalSearchParams } from "expo-router";
import { EnvelopeScreen } from "@/features/money/envelope-screen";

export default function Envelope() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <EnvelopeScreen id={id} />;
}
