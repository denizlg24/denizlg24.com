import { Stack } from "expo-router";
import { addFoodModalRoutes } from "@/features/add-food/routes";
import { logModalRoutes } from "@/features/log/routes";
import { moreModalRoutes } from "@/features/more/routes";
import { progressModalRoutes } from "@/features/progress/routes";
import { shellModalRoutes } from "@/features/shell/routes";
import { TimezoneSync } from "@/features/shell/timezone-sync";
import { todayModalRoutes } from "@/features/today/routes";

const modalRoutes = [
  ...shellModalRoutes,
  ...todayModalRoutes,
  ...addFoodModalRoutes,
  ...logModalRoutes,
  ...progressModalRoutes,
  ...moreModalRoutes,
];

export default function AppLayout() {
  return (
    <>
      <TimezoneSync />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        {modalRoutes.map((route) => (
          <Stack.Screen
            key={route.name}
            name={route.name}
            options={route.options}
          />
        ))}
      </Stack>
    </>
  );
}
