import type { LucideIcon } from "lucide-react-native";
import { memo } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { colors, spacing } from "@/ui";
import { Focusable, type FocusTargets } from "./focusable";
import { TvText } from "./tv-text";

export interface TvButtonProps {
  label: string;
  icon?: LucideIcon;
  /** Solid glyph, e.g. the play triangle. */
  filledIcon?: boolean;
  onPress: () => void;
  preferred?: boolean;
  disabled?: boolean;
  loading?: boolean;
  /** False keeps it on screen but out of the remote's reach. */
  focusable?: boolean;
  focusKey?: string;
  next?: FocusTargets;
  onFocus?: () => void;
  /** Icon only, with the label kept for TalkBack. */
  compact?: boolean;
}

/**
 * The TV's button: translucent at rest, solid paper with ink type under
 * focus, the way every TV interface marks the one thing OK will press.
 */
export const TvButton = memo(function TvButton({
  label,
  icon: Icon,
  filledIcon,
  onPress,
  preferred,
  disabled,
  loading,
  focusable,
  focusKey,
  next,
  onFocus,
  compact,
}: TvButtonProps) {
  return (
    <Focusable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      onPress={onPress}
      preferred={preferred}
      disabled={disabled || loading}
      focusable={focusable === false ? false : undefined}
      focusKey={focusKey}
      next={next}
      onFocus={onFocus}
      ringless
      grow={1.05}
    >
      {(focused) => {
        const foreground = focused ? colors.ink : colors.paper;
        return (
          <View
            style={[
              styles.button,
              compact ? styles.compact : null,
              {
                backgroundColor: focused ? colors.paper : BUTTON_FILL,
                opacity: disabled ? 0.45 : 1,
              },
            ]}
          >
            {loading ? (
              <ActivityIndicator color={foreground} />
            ) : (
              <>
                {Icon ? (
                  <Icon
                    size={20}
                    color={foreground}
                    fill={filledIcon ? foreground : "none"}
                  />
                ) : null}
                {compact ? null : (
                  <TvText
                    variant="bodyStrong"
                    numberOfLines={1}
                    style={{ color: foreground }}
                  >
                    {label}
                  </TvText>
                )}
              </>
            )}
          </View>
        );
      }}
    </Focusable>
  );
});

const BUTTON_FILL = "rgba(239,233,223,0.16)";

const styles = StyleSheet.create({
  button: {
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: 6,
  },
  compact: { width: 44, paddingHorizontal: 0, justifyContent: "center" },
});
