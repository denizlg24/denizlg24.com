import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/**
 * The keyboard's height on Android, where an edge-to-edge window no longer
 * shrinks for it and `automaticallyAdjustKeyboardInsets` does not exist.
 * Always 0 on iOS, which insets scroll views itself.
 */
export function useAndroidKeyboardHeight(enabled: boolean): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!enabled || Platform.OS !== "android") return;
    const show = Keyboard.addListener("keyboardDidShow", (event) =>
      setHeight(event.endCoordinates.height),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
      setHeight(0);
    };
  }, [enabled]);

  return height;
}
