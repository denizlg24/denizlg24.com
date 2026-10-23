import { Redirect } from "expo-router";
import { useAudience } from "@/lib/audience-store";

/** `/` lands on the lead profile's first surface. */
export default function Index() {
  const { layout } = useAudience();
  return <Redirect href={layout === "classic" ? "/home" : "/tonight"} />;
}
