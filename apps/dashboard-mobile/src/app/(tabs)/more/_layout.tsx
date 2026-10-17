import { useStackOptions } from "@repo/native-ui";
import { Stack } from "expo-router";

export default function TabStack() {
  return (
    <Stack screenOptions={useStackOptions()}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
    </Stack>
  );
}
