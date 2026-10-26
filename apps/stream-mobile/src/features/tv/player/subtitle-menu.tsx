import { Check } from "lucide-react-native";
import { useEffect } from "react";
import { BackHandler, ScrollView, StyleSheet, View } from "react-native";
import { colors, radius, spacing, Text } from "@/ui";
import { FOCUS_ROOM, Focusable } from "../focusable";
import { TV_SAFE } from "../layout";

export interface SubtitleOption {
  key: string;
  label: string;
  detail?: string | null;
  selected: boolean;
  onPress: () => void;
}

/**
 * A panel down the right of the picture. The chosen line keeps the remote's
 * focus when it opens; Back closes it without changing anything.
 */
export function TvSubtitleMenu({
  options,
  note,
  onClose,
}: {
  options: SubtitleOption[];
  /** One line under the heading, e.g. why only Off is offered. */
  note?: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        onClose();
        return true;
      },
    );
    return () => subscription.remove();
  }, [onClose]);

  return (
    <View style={styles.scrim}>
      <View style={styles.panel}>
        <Text variant="title">Subtitles</Text>
        {note ? (
          <Text variant="body" color="muted">
            {note}
          </Text>
        ) : null}
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          {options.map((option) => (
            <Focusable
              key={option.key}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected: option.selected }}
              preferred={option.selected}
              onPress={option.onPress}
              style={styles.row}
              radius={radius.sm}
              grow={1.02}
            >
              <View style={styles.check}>
                {option.selected ? (
                  <Check color={colors.amber} size={20} />
                ) : null}
              </View>
              <View style={styles.text}>
                <Text
                  variant="headline"
                  color={option.selected ? "amber" : "paper"}
                  numberOfLines={1}
                >
                  {option.label}
                </Text>
                {option.detail ? (
                  <Text variant="caption" color="muted" numberOfLines={1}>
                    {option.detail}
                  </Text>
                ) : null}
              </View>
            </Focusable>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "flex-end",
  },
  panel: {
    width: 380,
    height: "100%",
    paddingTop: TV_SAFE.y + spacing.lg,
    paddingLeft: spacing.xl,
    paddingRight: TV_SAFE.x,
    gap: spacing.sm,
    backgroundColor: "rgba(12,11,10,0.94)",
  },
  list: { flex: 1 },
  listContent: {
    paddingVertical: FOCUS_ROOM,
    paddingHorizontal: FOCUS_ROOM / 2,
    paddingBottom: TV_SAFE.y + spacing.lg,
    gap: spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  check: { width: 22, alignItems: "center" },
  text: { flex: 1, gap: spacing.xxs },
});
