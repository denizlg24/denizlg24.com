import { useLocalSearchParams } from "expo-router";
import { EntryScreen } from "@/features/money/entry-screen";

export default function Entry() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <EntryScreen id={id} />;
}
