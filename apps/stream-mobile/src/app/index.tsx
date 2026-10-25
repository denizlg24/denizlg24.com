import { Redirect } from "expo-router";
import { Platform } from "react-native";
import { useAudience } from "@/lib/audience-store";

/** `/` lands on the lead profile's first surface; a TV has one of its own. */
export default function Index() {
  const { layout } = useAudience();
  if (Platform.isTV) return <Redirect href="/tv" />;
  return <Redirect href={layout === "classic" ? "/home" : "/tonight"} />;
}
