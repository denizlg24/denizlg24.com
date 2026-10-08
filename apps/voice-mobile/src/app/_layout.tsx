import { useAuthState } from "@repo/native-auth/react";
import * as Notifications from "expo-notifications";
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
import { SignIn } from "@/features/voice/sign-in";
import { VoiceProvider } from "@/features/voice/voice-controller";
import { auth } from "@/lib/auth";

void SplashScreen.preventAutoHideAsync();
void auth.hydrate();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export default function RootLayout() {
  const scheme = useColorScheme();
  const state = useAuthState(auth);

  useEffect(() => {
    if (state.status !== "loading") void SplashScreen.hideAsync();
    if (state.status === "signed-in") {
      void Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowSound: false, allowBadge: false },
      });
    }
  }, [state.status]);

  if (state.status === "loading") return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={scheme === "dark" ? DarkTheme : DefaultTheme}>
        {state.status === "signed-in" ? (
          <VoiceProvider>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="listen" options={{ animation: "none" }} />
              <Stack.Screen
                name="conversation"
                options={{
                  presentation: "formSheet",
                  sheetGrabberVisible: true,
                  sheetAllowedDetents: [0.5, 1],
                }}
              />
            </Stack>
          </VoiceProvider>
        ) : (
          <SignIn />
        )}
        <StatusBar style="auto" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
