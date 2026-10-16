import { useAuthState } from "@repo/native-auth/react";
import { colors } from "@repo/native-ui";
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
import { SignIn } from "@/features/shell/sign-in";
import { auth } from "@/lib/auth";
import { queryClient, wireFocus } from "@/lib/query";

void SplashScreen.preventAutoHideAsync();
void auth.hydrate();

export const unstable_settings = { initialRouteName: "(tabs)" };

const sheet = {
  presentation: "formSheet",
  sheetGrabberVisible: true,
  headerShown: true,
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
            <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen
                name="chat"
                options={{ presentation: "modal", headerShown: false }}
              />
              <Stack.Screen
                name="board-picture"
                options={{
                  presentation: "fullScreenModal",
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="compose"
                options={{ presentation: "modal", headerShown: true }}
              />
              <Stack.Screen
                name="board-note"
                options={{ ...sheet, sheetAllowedDetents: [0.6, 1] }}
              />
              <Stack.Screen
                name="oauth/callback"
                options={{ headerShown: false }}
              />
            </Stack>
          ) : (
            <SignIn />
          )}
        </QueryClientProvider>
        <StatusBar style="auto" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
