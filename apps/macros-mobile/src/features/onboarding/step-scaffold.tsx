import { useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router";
import type { ReactNode } from "react";
import { Alert, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useProfile } from "@/api/profile";
import { signOut } from "@/lib/session";
import {
  Button,
  colors,
  gutter,
  Hairline,
  InlineNotice,
  Screen,
  spacing,
  Text,
  VStack,
} from "@/ui";
import { glyphs } from "@/ui/glyphs";
import { ONBOARDING_STEPS, type StepKey, stepPosition } from "./model";
import { useKeyboardInset } from "./use-keyboard-inset";

export interface StepScaffoldProps {
  step: StepKey;
  intro?: string;
  children: ReactNode;
  continueLabel?: string;
  onContinue: () => void;
  busy?: boolean;
  /** A failure of the continue action itself, pinned above the button. */
  error?: string | null;
}

/**
 * Every wizard step: progress and a short intro under the large title, the
 * step's controls, and Continue pinned at the bottom where the thumb is. The
 * footer rides up with the keyboard so Continue stays reachable from a
 * decimal pad, which has no return key.
 */
export function StepScaffold({
  step,
  intro,
  children,
  continueLabel = "Continue",
  onContinue,
  busy = false,
  error,
}: StepScaffoldProps) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();
  const safeBottom = insets.bottom;
  const footerStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(safeBottom, keyboard.value) + spacing.md,
  }));
  const position = stepPosition(step);

  return (
    <View style={styles.root}>
      <Screen
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.content}
      >
        <VStack gap={spacing.xl}>
          <StepProgress current={position.number} total={position.total} />
          {intro ? (
            <Text variant="body" tone="secondary">
              {intro}
            </Text>
          ) : null}
          {children}
        </VStack>
      </Screen>
      <Animated.View style={[styles.footer, footerStyle]}>
        <Hairline style={styles.footerRule} />
        {error ? <InlineNotice message={error} /> : null}
        <Button label={continueLabel} loading={busy} onPress={onContinue} />
      </Animated.View>
      <OnboardingMenu />
    </View>
  );
}

function StepProgress({ current, total }: { current: number; total: number }) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${current} of ${total}`}
      accessibilityValue={{ min: 1, max: total, now: current }}
      style={styles.progress}
    >
      <Text variant="caption1" tone="secondary" eyebrow figure>
        Step {current} of {total}
      </Text>
      <View style={styles.segments}>
        {ONBOARDING_STEPS.map((item, index) => (
          <View
            key={item.key}
            style={[
              styles.segment,
              {
                backgroundColor: index < current ? colors.label : colors.fill,
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

function OnboardingMenu() {
  const queryClient = useQueryClient();
  const profile = useProfile();

  function confirmSignOut() {
    Alert.alert("Sign out?", "Your answers so far won’t be kept.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => void signOut(queryClient),
      },
    ]);
  }

  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu
        icon={glyphs["circle-user"]}
        iconRenderingMode="template"
        accessibilityLabel="Account"
        title={profile.data?.email}
      >
        <Stack.Toolbar.MenuAction
          icon={glyphs["log-out"]}
          iconRenderingMode="template"
          destructive
          onPress={confirmSignOut}
        >
          Sign out
        </Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: spacing.xl,
  },
  footer: {
    gap: spacing.sm,
    paddingHorizontal: gutter,
    backgroundColor: colors.background,
  },
  footerRule: {
    marginHorizontal: -gutter,
    marginBottom: spacing.xs,
  },
  progress: {
    gap: spacing.sm,
  },
  segments: {
    flexDirection: "row",
    gap: 3,
  },
  segment: {
    flex: 1,
    height: 3,
    borderRadius: 1.5,
  },
});
