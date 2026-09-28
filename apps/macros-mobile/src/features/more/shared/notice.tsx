import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { errorMessage, NetworkError } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import { colors, gutter, InlineNotice, type InlineNoticeProps } from "@/ui";

export type Notice = Pick<InlineNoticeProps, "message" | "tone" | "action">;

/** One notice per surface; a newer one replaces the older. */
export function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);

  const show = useCallback((next: Notice) => setNotice(next), []);
  const showError = useCallback((error: unknown) => {
    haptics.error();
    setNotice({
      message: errorMessage(error),
      tone: error instanceof NetworkError ? "offline" : "error",
    });
  }, []);
  const clear = useCallback(() => setNotice(null), []);

  return { notice, show, showError, clear };
}

/**
 * Rendered as the first child of a `Screen` with `stickyHeaderIndices={[0]}`
 * so an error stays pinned under the header instead of scrolling away with
 * the row that raised it. Collapses to nothing when there is no notice.
 */
export function NoticeSlot({
  notice,
  onDismiss,
  inset = false,
}: {
  notice: Notice | null;
  onDismiss: () => void;
  /** Add the gutter when the screen is edge to edge (`bleed`). */
  inset?: boolean;
}) {
  return (
    <View style={[styles.slot, inset && styles.inset]}>
      {notice ? (
        <InlineNotice
          message={notice.message}
          tone={notice.tone}
          action={notice.action}
          onDismiss={onDismiss}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    backgroundColor: colors.background,
  },
  inset: {
    paddingHorizontal: gutter,
  },
});
