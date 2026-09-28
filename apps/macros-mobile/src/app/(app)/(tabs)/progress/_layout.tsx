import { Stack } from "expo-router";
import { tabStackOptions } from "@/features/shell/routes";

export default function Layout() {
  return (
    <Stack screenOptions={tabStackOptions}>
      <Stack.Screen name="index" options={{ title: "Progress" }} />
      <Stack.Screen name="strategy" options={{ title: "Strategy" }} />
      <Stack.Screen name="goals" options={{ title: "Goals" }} />
      <Stack.Screen name="statistics" options={{ title: "Statistics" }} />
    </Stack>
  );
}
