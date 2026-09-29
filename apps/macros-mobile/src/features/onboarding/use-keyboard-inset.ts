import { useEffect } from "react";
import { Keyboard, type KeyboardEvent, Platform } from "react-native";
import {
  Easing,
  type SharedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

// Close to UIKit's keyboard curve, which is not a public timing function.
const KEYBOARD_EASING = Easing.bezier(0.17, 0.59, 0.4, 0.77);

// Android only reports the keyboard once it has moved.
const SHOW = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
const HIDE = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

/**
 * The keyboard's height, animated with the keyboard. Valid for full-height
 * screens only: the keyboard rises from the window's bottom edge, which is
 * the screen's bottom edge only when nothing (a tab bar, a sheet) is below.
 */
export function useKeyboardInset(): SharedValue<number> {
  const height = useSharedValue(0);

  useEffect(() => {
    function follow(to: number, event: KeyboardEvent) {
      height.value = withTiming(to, {
        duration: event.duration > 0 ? event.duration : 250,
        easing: KEYBOARD_EASING,
      });
    }
    const show = Keyboard.addListener(SHOW, (event) =>
      follow(event.endCoordinates.height, event),
    );
    const hide = Keyboard.addListener(HIDE, (event) => follow(0, event));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [height]);

  return height;
}
