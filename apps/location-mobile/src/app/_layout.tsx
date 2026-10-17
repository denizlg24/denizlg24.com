import { useAuthState } from "@repo/native-auth/react";
import {
  navigationFonts,
  useNavigationColors,
  useStackOptions,
} from "@repo/native-ui";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  DarkTheme,
  DefaultTheme,
  SplashScreen,
  Stack,
  type Theme,
  ThemeProvider,
} from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { registerForPush } from "@/features/push/push";
import { SignIn } from "@/features/shell/sign-in";
import { auth } from "@/lib/auth";
import { queryClient, wireFocus } from "@/lib/query";

void SplashScreen.preventAutoHideAsync();
void auth.hydrate();

function useNavigationTheme(): Theme {
  const base = useColorScheme() === "dark" ? DarkTheme : DefaultTheme;
  const colors = useNavigationColors();
  return {
    ...base,
    colors: { ...base.colors, ...colors },
    fonts: navigationFonts,
  };
}

export default function RootLayout() {
  const theme = useNavigationTheme();
  const stackOptions = useStackOptions();
  const state = useAuthState(auth);

  useEffect(() => wireFocus(), []);

  useEffect(() => {
    if (state.status !== "loading") void SplashScreen.hideAsync();
    if (state.status === "signed-out") queryClient.clear();
  }, [state.status]);

  useEffect(() => {
    if (state.status !== "signed-in") return;
    registerForPush().catch((error: unknown) =>
      console.warn("[push] registration failed", error),
    );
  }, [state.status]);

  if (state.status === "loading") return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={theme}>
        <QueryClientProvider client={queryClient}>
          {state.status === "signed-in" ? (
            <Stack screenOptions={stackOptions}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
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
