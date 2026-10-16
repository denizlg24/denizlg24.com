import { useLocalSearchParams } from "expo-router";
import { RunScreen } from "@/features/more/tasks-screen";

export default function Run() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RunScreen id={id} />;
}
