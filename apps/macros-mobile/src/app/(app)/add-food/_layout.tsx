import { Stack } from "expo-router";
import { hubStackOptions, hubStackRoutes } from "@/features/add-food/routes";

// Opening the plate straight from the scanner still puts the hub under it.
export const unstable_settings = { initialRouteName: "index" };

export default function Layout() {
  return (
    <Stack screenOptions={hubStackOptions}>
      {hubStackRoutes.map((route) => (
        <Stack.Screen
          key={route.name}
          name={route.name}
          options={route.options}
        />
      ))}
    </Stack>
  );
}
