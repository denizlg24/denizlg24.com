import { colors } from "@repo/native-ui";
import { Stack } from "expo-router";

export default function ChatStack() {
  return (
    <Stack
      screenOptions={{
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Agent" }} />
    </Stack>
  );
}
