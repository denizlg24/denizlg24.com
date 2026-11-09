import { decodeActorName } from "@repo/schemas/stream";
import { useLocalSearchParams } from "expo-router";
import { GridScreen } from "@/features/browse/grid-screen";

export default function Actor() {
  const params = useLocalSearchParams<{ name: string }>();
  const name = decodeActorName(params.name ?? "");
  return (
    <GridScreen
      key={name}
      title={name}
      params={{ actor: name, sort: "newest" }}
    />
  );
}
