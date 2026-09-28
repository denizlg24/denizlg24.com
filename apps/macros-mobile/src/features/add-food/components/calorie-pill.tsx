import { StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { type EnergyUnit, energyLabel, formatEnergy } from "@/lib/format";
import { macroColors, Text, useResolvedColors } from "@/ui";

const WIDTH = 116;
const HEIGHT = 36;
const STROKE = 3;

const INSET = STROKE / 2;
const RADIUS = (HEIGHT - STROKE) / 2;
const LEFT = INSET + RADIUS;
const RIGHT = WIDTH - INSET - RADIUS;
const TOP = INSET;
const BOTTOM = HEIGHT - INSET;

// Clockwise from the top centre. A rounded `Rect` would do, except that
// react-native-svg starts its path somewhere else on iOS, which moves where
// the dashes begin.
const OUTLINE = [
  `M ${WIDTH / 2} ${TOP}`,
  `H ${RIGHT}`,
  `A ${RADIUS} ${RADIUS} 0 0 1 ${RIGHT} ${BOTTOM}`,
  `H ${LEFT}`,
  `A ${RADIUS} ${RADIUS} 0 0 1 ${LEFT} ${TOP}`,
  "Z",
].join(" ");
const PERIMETER = 2 * (RIGHT - LEFT) + 2 * Math.PI * RADIUS;

const CAMERA_FILL = "rgba(0,0,0,0.5)";
const CAMERA_RIM = "rgba(255,255,255,0.25)";

/**
 * Today's energy against the target, with what is staged on the plate drawn
 * after it at half strength, the outline filling clockwise from the top.
 */
export function CaloriePill({
  consumed,
  staged,
  target,
  energyUnit,
  onCamera = false,
}: {
  consumed: number;
  staged: number;
  target: number | null;
  energyUnit: EnergyUnit;
  /** Over a camera feed: dark glass whatever the appearance. */
  onCamera?: boolean;
}) {
  const resolved = useResolvedColors();
  const fill = onCamera ? CAMERA_FILL : resolved.fill;
  const rim = onCamera ? CAMERA_RIM : resolved.separator;
  const eaten = target && target > 0 ? Math.min(consumed / target, 1) : 0;
  const pending =
    target && target > 0 ? Math.min(staged / target, 1 - eaten) : 0;
  const total = consumed + staged;
  const label = `${formatEnergy(total, energyUnit)} / ${
    target ? formatEnergy(target, energyUnit) : "—"
  }`;

  return (
    <View
      style={styles.pill}
      accessibilityRole="text"
      accessibilityLabel={
        target
          ? `${formatEnergy(total, energyUnit)} of ${formatEnergy(target, energyUnit)} ${energyLabel(energyUnit)}, including the plate`
          : `${formatEnergy(total, energyUnit)} ${energyLabel(energyUnit)}`
      }
    >
      <Svg width={WIDTH} height={HEIGHT} style={StyleSheet.absoluteFill}>
        <Path d={OUTLINE} fill={fill} stroke={rim} strokeWidth={STROKE} />
        {eaten > 0 ? (
          <Path
            d={OUTLINE}
            fill="none"
            stroke={macroColors.calories}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${eaten * PERIMETER} ${PERIMETER}`}
          />
        ) : null}
        {pending > 0 ? (
          <Path
            d={OUTLINE}
            fill="none"
            stroke={macroColors.calories}
            strokeOpacity={0.45}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${pending * PERIMETER} ${PERIMETER}`}
            strokeDashoffset={-eaten * PERIMETER}
          />
        ) : null}
      </Svg>
      <Text
        variant="subheadline"
        weight="medium"
        figure
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[styles.label, onCamera && styles.cameraLabel]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    width: WIDTH,
    height: HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    paddingHorizontal: 12,
  },
  cameraLabel: {
    color: "#ffffff",
  },
});
