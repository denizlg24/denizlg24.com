import { useLocalSearchParams } from "expo-router";
import { ShiftSheet } from "@/features/shift/shift-sheet";

export default function ShiftRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  // A new key per shift: the editor seeds its state from the row once.
  return <ShiftSheet key={id ?? "new"} id={id} />;
}
