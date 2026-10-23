import { useLocalSearchParams } from "expo-router";
import { PlayerScreen } from "@/features/player/player-screen";

export default function Watch() {
  const { id, episode } = useLocalSearchParams<{
    id: string;
    episode?: string;
  }>();
  return (
    <PlayerScreen
      key={`${id}:${episode ?? ""}`}
      id={id}
      episode={episode ?? null}
    />
  );
}
