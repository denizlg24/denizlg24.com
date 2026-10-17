import { useStackOptions } from "@repo/native-ui";
import { Stack } from "expo-router";

export default function ChatStack() {
  return (
    <Stack screenOptions={useStackOptions()}>
      <Stack.Screen name="index" options={{ title: "Agent" }} />
    </Stack>
  );
}
