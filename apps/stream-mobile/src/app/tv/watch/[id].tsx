import { useLocalSearchParams } from "expo-router";
import { TvPlayerScreen } from "@/features/tv/player/tv-player-screen";

export default function Watch() {
  const { id, episode } = useLocalSearchParams<{
    id: string;
    episode?: string;
  }>();
  return (
    <TvPlayerScreen
      key={`${id}:${episode ?? ""}`}
      id={id}
      episode={episode ?? null}
    />
  );
}
