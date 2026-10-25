import { useLocalSearchParams } from "expo-router";
import { TvTitleScreen } from "@/features/tv/title-screen";

export default function Title() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TvTitleScreen key={id} id={id} />;
}
