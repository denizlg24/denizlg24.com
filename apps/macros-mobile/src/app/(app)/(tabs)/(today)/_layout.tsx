import { Stack } from "expo-router";
import { tabRootOptions, tabStackOptions } from "@/features/shell/routes";

export default function Layout() {
  return (
    <Stack screenOptions={tabStackOptions}>
      <Stack.Screen
        name="index"
        options={{ ...tabRootOptions, title: "Today" }}
      />
      <Stack.Screen name="strategy" options={{ title: "Strategy" }} />
    </Stack>
  );
}
