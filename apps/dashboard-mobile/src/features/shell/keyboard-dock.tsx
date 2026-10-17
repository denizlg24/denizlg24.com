import { colors } from "@repo/native-ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  Keyboard,
  type KeyboardEvent,
  LayoutAnimation,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * A full-height column whose bottom edge follows the keyboard, and otherwise
 * stops above the home indicator, so a composer pinned to the bottom never
 * sits in the screen's rounded corners.
 *
 * KeyboardAvoidingView measures itself against its parent, which inside a
 * sheet under a header needs a hand-tuned offset; this measures against the
 * window instead.
 */
export function KeyboardDock({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const container = useRef<View>(null);
  const [overlap, setOverlap] = useState(0);

  useEffect(() => {
    const animate = (event: KeyboardEvent) => {
      if (event.duration > 0) {
        LayoutAnimation.configureNext({
          duration: event.duration,
          update: { type: LayoutAnimation.Types.keyboard },
        });
      }
    };
    // Measured when the keyboard moves, not on layout: a sheet lays out
    // while it is still sliding in, which would put its bottom off screen.
    const show = Keyboard.addListener("keyboardWillChangeFrame", (event) => {
      container.current?.measureInWindow((_x, y, _width, height) => {
        animate(event);
        setOverlap(Math.max(0, y + height - event.endCoordinates.screenY));
      });
    });
    const hide = Keyboard.addListener("keyboardWillHide", (event) => {
      animate(event);
      setOverlap(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return (
    <View ref={container} style={styles.dock}>
      {children}
      <View style={{ height: overlap > 0 ? overlap : insets.bottom }} />
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { flex: 1, backgroundColor: colors.background },
});
