import { decodeActorName } from "@repo/schemas/stream";
import { useLocalSearchParams } from "expo-router";
import { TvActorScreen } from "@/features/tv/actor-screen";

export default function Actor() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const decoded = decodeActorName(name ?? "");
  return <TvActorScreen key={decoded} name={decoded} />;
}
