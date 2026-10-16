import { useLocalSearchParams } from "expo-router";
import { MemoryScreen } from "@/features/more/memory-screen";

export default function Memory() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <MemoryScreen id={id} />;
}
