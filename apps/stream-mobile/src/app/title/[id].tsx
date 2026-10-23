import { useLocalSearchParams } from "expo-router";
import { TitleScreen } from "@/features/title/title-screen";

export default function Title() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TitleScreen key={id} id={id} />;
}
