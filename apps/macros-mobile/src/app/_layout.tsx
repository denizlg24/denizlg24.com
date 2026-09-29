import { useQueryClient } from "@tanstack/react-query";
import {
  DarkTheme,
  DefaultTheme,
  SplashScreen,
  Stack,
  ThemeProvider,
} from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import {
  ActivityIndicator,
  Platform,
  useColorScheme,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useProfile } from "@/api/profile";
import { ConnectionProblem } from "@/features/shell/connection-problem";
import { setUnauthorizedHandler } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { installNavigationGuard } from "@/lib/navigation-guard";
import { QueryProviders } from "@/lib/providers";
import { wireReactQueryToNative } from "@/lib/query-client";
import { forgetSessionLocally } from "@/lib/session";
import { colors } from "@/ui";
import { AndroidDialogHost } from "@/ui/android-dialogs";

void SplashScreen.preventAutoHideAsync();
wireReactQueryToNative();
installNavigationGuard();

// Signing in remounts the query provider, and the gate waits on the new
// user's profile. The splash is long gone by then, so that wait needs a view.
let splashHidden = false;

export default function RootLayout() {
  const scheme = useColorScheme();
  const session = authClient.useSession();
  const userId = session.data?.user.id ?? null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={scheme === "dark" ? DarkTheme : DefaultTheme}>
        <QueryProviders userId={userId}>
          <RootNavigator
            // Android resolves a colour resource once, when a view is made, so
            // a dark mode switch redraws the tree to pick up the other palette.
            key={Platform.OS === "android" ? (scheme ?? "light") : undefined}
            userId={userId}
            sessionPending={session.isPending}
          />
        </QueryProviders>
        {Platform.OS === "android" ? <AndroidDialogHost /> : null}
        <StatusBar style="auto" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator({
  userId,
  sessionPending,
}: {
  userId: string | null;
  sessionPending: boolean;
}) {
  const queryClient = useQueryClient();
  const signedIn = userId !== null;
  const profile = useProfile(signedIn);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      queryClient.clear();
      void forgetSessionLocally();
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

  const profileSettled =
    !signedIn || profile.data !== undefined || profile.isError;
  const ready = !sessionPending && profileSettled;

  useEffect(() => {
    if (!ready) return;
    splashHidden = true;
    void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) {
    return splashHidden ? (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator />
      </View>
    ) : null;
  }

  if (signedIn && profile.data === undefined) {
    return <ConnectionProblem onRetry={() => void profile.refetch()} />;
  }

  const onboarded = profile.data?.onboardingCompleted === true;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !onboarded}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && onboarded}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
  );
}
