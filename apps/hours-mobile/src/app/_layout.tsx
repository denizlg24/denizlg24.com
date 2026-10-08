import { useAuthState } from "@repo/native-auth/react";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  DarkTheme,
  DefaultTheme,
  SplashScreen,
  Stack,
  ThemeProvider,
} from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { HoursSync } from "@/features/native/hours-sync";
import { SignIn } from "@/features/shell/sign-in";
import { auth } from "@/lib/auth";
import { queryClient, wireFocus } from "@/lib/query";
import { colors } from "@/ui";

void SplashScreen.preventAutoHideAsync();
void auth.hydrate();

export const unstable_settings = { initialRouteName: "(tabs)" };

const sheet = {
  presentation: "formSheet",
  sheetGrabberVisible: true,
  contentStyle: { backgroundColor: colors.background },
} as const;

export default function RootLayout() {
  const scheme = useColorScheme();
  const state = useAuthState(auth);

  useEffect(() => wireFocus(), []);

  useEffect(() => {
    if (state.status !== "loading") void SplashScreen.hideAsync();
    if (state.status === "signed-out") queryClient.clear();
  }, [state.status]);

  if (state.status === "loading") return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={scheme === "dark" ? DarkTheme : DefaultTheme}>
        <QueryClientProvider client={queryClient}>
          {state.status === "signed-in" ? (
            <>
              <HoursSync />
              <Stack>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen
                  name="shift"
                  options={{
                    ...sheet,
                    presentation: "modal",
                    headerShown: true,
                    title: "Shift",
                  }}
                />
                <Stack.Screen
                  name="earlier"
                  options={{
                    ...sheet,
                    headerShown: false,
                    sheetAllowedDetents: "fitToContents",
                  }}
                />
                <Stack.Screen
                  name="jobs"
                  options={{
                    ...sheet,
                    headerShown: true,
                    title: "Jobs",
                    sheetAllowedDetents: [0.7, 1],
                  }}
                />
                <Stack.Screen
                  name="settings"
                  options={{
                    ...sheet,
                    headerShown: true,
                    title: "Reminders",
                    sheetAllowedDetents: [0.7, 1],
                  }}
                />
                <Stack.Screen
                  name="oauth/callback"
                  options={{ headerShown: false }}
                />
              </Stack>
            </>
          ) : (
            <SignIn />
          )}
        </QueryClientProvider>
        <StatusBar style="auto" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
