import { Redirect } from "expo-router";
import { Platform } from "react-native";

/** `/` lands on Home; a TV has a home of its own. */
export default function Index() {
  return <Redirect href={Platform.isTV ? "/tv" : "/home"} />;
}
