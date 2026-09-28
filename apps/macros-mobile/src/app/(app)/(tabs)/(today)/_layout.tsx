import { Stack } from "expo-router";
import { tabStackOptions } from "@/features/shell/routes";

export default function Layout() {
  return (
    <Stack screenOptions={tabStackOptions}>
      <Stack.Screen name="index" options={{ title: "Today" }} />
    </Stack>
  );
}
