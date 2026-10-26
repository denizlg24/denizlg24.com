import "@/lib/polyfills";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  DarkTheme,
  SplashScreen,
  Stack,
  type Theme,
  ThemeProvider,
} from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { MemberGate } from "@/features/shell/member-gate";
import { SignIn } from "@/features/shell/sign-in";
import { TvSignInScreen } from "@/features/tv/sign-in-screen";
import { TvWhoScreen } from "@/features/tv/who-screen";
import { loadAudience } from "@/lib/audience-store";
import { session, useSession } from "@/lib/auth";
import { queryClient, wireFocus } from "@/lib/query";
import { loadSubtitlePreference } from "@/lib/subtitle-preference";
import { colors } from "@/ui";

void SplashScreen.preventAutoHideAsync();
void session.hydrate();
void loadAudience();
void loadSubtitlePreference();

const theme: Theme = {
  ...DarkTheme,
  dark: true,
  colors: {
    ...DarkTheme.colors,
    primary: colors.amber,
    background: colors.ink,
    card: colors.ink,
    text: colors.paper,
    border: colors.hairline,
  },
};

/** Short tasks are sheets on iOS; Android gets a plain modal, which it renders reliably. */
const sheet =
  Platform.OS === "ios"
    ? {
        presentation: "formSheet" as const,
        sheetGrabberVisible: true,
        sheetAllowedDetents: [0.9, 1],
      }
    : {
        presentation: "modal" as const,
        animation: "slide_from_bottom" as const,
      };

/** Google TV and Android TV: a remote, a landscape screen, no browser. */
const tv = Platform.isTV;

export default function RootLayout() {
  const state = useSession();

  useEffect(() => wireFocus(), []);

  useEffect(() => {
    if (state.status !== "loading") void SplashScreen.hideAsync();
    if (state.status === "signed-out") queryClient.clear();
  }, [state.status]);

  if (state.status === "loading") return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.ink }}>
      <ThemeProvider value={theme}>
        <QueryClientProvider client={queryClient}>
          {state.status === "signed-in" ? (
            <MemberGate>
              {(layout) =>
                tv ? (
                  layout === null ? (
                    <TvWhoScreen />
                  ) : (
                    <Stack
                      screenOptions={{
                        headerShown: false,
                        orientation: "landscape",
                        animation: "fade",
                        contentStyle: { backgroundColor: colors.ink },
                      }}
                    >
                      <Stack.Screen name="tv/index" />
                      <Stack.Screen name="tv/tonight" />
                      <Stack.Screen name="tv/ask" />
                      <Stack.Screen name="tv/tune" />
                      <Stack.Screen name="tv/search" />
                      <Stack.Screen name="tv/list" />
                      <Stack.Screen name="tv/who" />
                      <Stack.Screen name="tv/title/[id]" />
                      <Stack.Screen name="tv/actor/[name]" />
                      <Stack.Screen
                        name="tv/watch/[id]"
                        options={{
                          contentStyle: { backgroundColor: "#000000" },
                        }}
                      />
                      <Stack.Screen name="index" />
                    </Stack>
                  )
                ) : (
                  <Stack
                    screenOptions={{
                      headerShown: false,
                      orientation: "portrait_up",
                      contentStyle: { backgroundColor: colors.ink },
                    }}
                  >
                    <Stack.Protected guard={layout === "studio"}>
                      <Stack.Screen name="(studio)" />
                    </Stack.Protected>
                    <Stack.Protected guard={layout === "classic"}>
                      <Stack.Screen name="(classic)" />
                    </Stack.Protected>
                    <Stack.Protected guard={layout !== null}>
                      <Stack.Screen name="index" />
                      <Stack.Screen name="title/[id]" />
                      <Stack.Screen
                        name="watch/[id]"
                        options={{
                          presentation: "fullScreenModal",
                          animation: "fade",
                          orientation: "landscape",
                          statusBarHidden: true,
                          navigationBarHidden: true,
                          contentStyle: { backgroundColor: "#000000" },
                        }}
                      />
                      <Stack.Screen name="actor/[name]" />
                      <Stack.Screen name="account" options={sheet} />
                    </Stack.Protected>
                    <Stack.Screen
                      name="sofa"
                      options={{
                        animation: "fade",
                        presentation:
                          layout === null ? "card" : "fullScreenModal",
                      }}
                    />
                    <Stack.Screen name="profile-edit" options={sheet} />
                    <Stack.Screen name="oauth/callback" />
                  </Stack>
                )
              }
            </MemberGate>
          ) : tv ? (
            <TvSignInScreen />
          ) : (
            <SignIn />
          )}
        </QueryClientProvider>
        <StatusBar style="light" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
