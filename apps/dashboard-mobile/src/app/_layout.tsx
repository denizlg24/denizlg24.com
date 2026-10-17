import { useAuthState } from "@repo/native-auth/react";
import {
  colors,
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
import { NotificationsSync } from "@/features/notifications/notifications-sync";
import { SignIn } from "@/features/shell/sign-in";
import { SpotlightSync } from "@/features/spotlight/spotlight-sync";
import { auth } from "@/lib/auth";
import {
  forgetQueries,
  queryClient,
  restoreQueries,
  wireFocus,
} from "@/lib/query";

void SplashScreen.preventAutoHideAsync();
void auth.hydrate();
restoreQueries();

export const unstable_settings = { initialRouteName: "(tabs)" };

const sheet = {
  presentation: "formSheet",
  sheetGrabberVisible: true,
  headerShown: true,
  contentStyle: { backgroundColor: colors.background },
} as const;

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
    if (state.status === "signed-out") {
      queryClient.clear();
      forgetQueries();
    }
  }, [state.status]);

  if (state.status === "loading") return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={theme}>
        <QueryClientProvider client={queryClient}>
          {state.status === "signed-in" ? (
            <>
              <NotificationsSync />
              <SpotlightSync />
              <Stack screenOptions={stackOptions}>
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
                  name="event"
                  options={{ ...sheet, sheetAllowedDetents: [0.75, 1] }}
                />
                <Stack.Screen
                  name="order"
                  options={{ ...sheet, sheetAllowedDetents: [0.7, 1] }}
                />
                <Stack.Screen
                  name="note-new"
                  options={{ ...sheet, sheetAllowedDetents: [0.5, 1] }}
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
