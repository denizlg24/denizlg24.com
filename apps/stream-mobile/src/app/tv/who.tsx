import { router } from "expo-router";
import { TvWhoScreen } from "@/features/tv/who-screen";

export default function Who() {
  return <TvWhoScreen onStarted={() => router.back()} />;
}
