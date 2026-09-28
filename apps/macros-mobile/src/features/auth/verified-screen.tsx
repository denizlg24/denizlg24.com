import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { haptics } from "@/lib/haptics";
import { colors, spacing, Text } from "@/ui";
import { signInWithPendingCredentials } from "./actions";
import type { AuthNotice } from "./auth-screen";
import { pendingCredentials } from "./memory";
import { SignInScreen } from "./sign-in-screen";

const VERIFIED_NOTICE: AuthNotice = {
  tone: "info",
  message: "Email verified. Sign in to continue.",
};

/**
 * `macros://verified`, opened by the web page the verification link lands on.
 * With the password still in memory from sign-up this finishes the sign-in on
 * its own; after a relaunch it is the sign-in form with a confirmation.
 */
export function VerifiedScreen() {
  const [signingIn, setSigningIn] = useState(
    () => pendingCredentials() !== null,
  );
  const [notice, setNotice] = useState<AuthNotice>(VERIFIED_NOTICE);

  useEffect(() => {
    const attempt = signInWithPendingCredentials();
    if (!attempt) {
      setSigningIn(false);
      return;
    }
    let active = true;
    void attempt.then((result) => {
      if (!active) return;
      if (result.ok) {
        haptics.success();
        return;
      }
      haptics.error();
      setNotice({ tone: "error", message: result.failure.message });
      setSigningIn(false);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!signingIn) return <SignInScreen notice={notice} />;

  return (
    <View style={styles.center} accessibilityLiveRegion="polite">
      <ActivityIndicator />
      <Text variant="subheadline" tone="secondary">
        Email verified. Signing you in…
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    backgroundColor: colors.background,
  },
});
