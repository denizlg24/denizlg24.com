import { Stack } from "expo-router";
import { kitchenStackRoutes } from "@/features/kitchen/routes";
import { tabStackOptions } from "@/features/shell/routes";

// A recipe opened from Today lands with the Kitchen under it to go back to.
export const unstable_settings = { initialRouteName: "index" };

export default function Layout() {
  return (
    <Stack screenOptions={tabStackOptions}>
      {kitchenStackRoutes.map((route) => (
        <Stack.Screen
          key={route.name}
          name={route.name}
          options={route.options}
        />
      ))}
    </Stack>
  );
}
