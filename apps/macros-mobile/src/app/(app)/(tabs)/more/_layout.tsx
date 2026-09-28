import { Stack } from "expo-router";
import { moreStackRoutes } from "@/features/more/routes";
import { tabStackOptions } from "@/features/shell/routes";

export default function Layout() {
  return (
    <Stack screenOptions={tabStackOptions}>
      {moreStackRoutes.map((route) => (
        <Stack.Screen
          key={route.name}
          name={route.name}
          options={route.options}
        />
      ))}
    </Stack>
  );
}
