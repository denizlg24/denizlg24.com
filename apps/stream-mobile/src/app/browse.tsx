import { useLocalSearchParams } from "expo-router";
import { GridScreen } from "@/features/browse/grid-screen";

/** `/browse?label=…&genres=…`: any `GET /titles` query as a poster grid. */
export default function Browse() {
  const raw = useLocalSearchParams<Record<string, string | string[]>>();
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (key !== "label" && first) params[key] = first;
  }
  const label = typeof raw.label === "string" ? raw.label : "Browse";
  return (
    <GridScreen key={JSON.stringify(params)} title={label} params={params} />
  );
}
