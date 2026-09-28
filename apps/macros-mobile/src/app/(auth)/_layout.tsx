import { Stack } from "expo-router";
import { tabStackOptions } from "@/features/shell/routes";

// The gate lands on this group without a path of its own; without an initial
// route the stack would open on whichever file sorts first.
export const unstable_settings = { initialRouteName: "sign-in" };

export default function AuthLayout() {
  return (
    <Stack screenOptions={tabStackOptions}>
      <Stack.Screen name="sign-in" options={{ title: "Sign in" }} />
      <Stack.Screen name="sign-up" options={{ title: "Create account" }} />
      <Stack.Screen
        name="verify-email"
        options={{ title: "Check your inbox" }}
      />
      <Stack.Screen name="verified" options={{ title: "Sign in" }} />
      <Stack.Screen
        name="forgot-password"
        options={{ title: "Reset password" }}
      />
    </Stack>
  );
}
