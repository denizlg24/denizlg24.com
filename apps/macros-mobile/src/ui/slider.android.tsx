import { Slider as MaterialSlider } from "@expo/ui/community/slider";
import type * as Shared from "./slider";
import { useResolvedColors } from "./theme";

export type { SliderProps } from "./slider";

export const Slider: typeof Shared.Slider = (props) => {
  const resolved = useResolvedColors();
  return (
    <MaterialSlider
      minimumTrackTintColor={resolved.label}
      maximumTrackTintColor={resolved.fill}
      thumbTintColor={resolved.label}
      {...props}
    />
  );
};
