import { Stack } from "expo-router";
import { tabStackOptions } from "@/features/shell/routes";

export default function Layout() {
  return (
    <Stack screenOptions={tabStackOptions}>
      <Stack.Screen name="index" options={{ title: "Today" }} />
      <Stack.Screen name="calendar" options={{ title: "Calendar" }} />
      <Stack.Screen name="nutrition" options={{ title: "Nutrition" }} />
      <Stack.Screen name="activity" options={{ title: "Logging" }} />
    </Stack>
  );
}
