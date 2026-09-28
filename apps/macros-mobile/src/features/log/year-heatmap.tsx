import type { MacrosFoodLogDayStatus } from "@repo/schemas/macros";
import { type GestureResponderEvent, Pressable, View } from "react-native";
import Svg, { Rect, Text as SvgText } from "react-native-svg";
import { useResolvedColors } from "@/ui";

const MONTH_LABELS = [
  "J",
  "F",
  "M",
  "A",
  "M",
  "J",
  "J",
  "A",
  "S",
  "O",
  "N",
  "D",
] as const;
const LABEL_WIDTH = 14;
const GAP = 2;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function daysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export interface YearHeatmapProps {
  year: number;
  width: number;
  today: string;
  statusByDate: ReadonlyMap<string, MacrosFoodLogDayStatus>;
  onSelectDay: (date: string) => void;
}

/**
 * One row per month, one column per day of the month: a year of logging at
 * a glance. Tapping a cell opens that day.
 */
export function YearHeatmap({
  year,
  width,
  today,
  statusByDate,
  onSelectDay,
}: YearHeatmapProps) {
  const resolved = useResolvedColors();
  const pitch = (width - LABEL_WIDTH) / 31;
  const cell = Math.max(2, pitch - GAP);
  const height = 12 * pitch;

  let tracked = 0;
  const cells = MONTH_LABELS.flatMap((_, month) =>
    Array.from({ length: daysInMonth(year, month) }, (_, dayIndex) => {
      const iso = `${year}-${pad(month + 1)}-${pad(dayIndex + 1)}`;
      const status = statusByDate.get(iso);
      if (status === "full") tracked += 1;
      const future = iso > today;
      return {
        iso,
        x: LABEL_WIDTH + dayIndex * pitch,
        y: month * pitch,
        fill:
          status === "full" || status === "partial"
            ? resolved.label
            : resolved.fill,
        opacity: future ? 0.25 : status === "partial" ? 0.35 : 1,
      };
    }),
  );

  function select(event: GestureResponderEvent) {
    const { locationX, locationY } = event.nativeEvent;
    const month = Math.floor(locationY / pitch);
    const day = Math.floor((locationX - LABEL_WIDTH) / pitch) + 1;
    if (month < 0 || month > 11 || day < 1 || day > daysInMonth(year, month))
      return;
    const iso = `${year}-${pad(month + 1)}-${pad(day)}`;
    if (iso <= today) onSelectDay(iso);
  }

  return (
    <Pressable
      onPress={select}
      accessibilityRole="image"
      accessibilityLabel={`${year}: ${tracked} ${tracked === 1 ? "day" : "days"} fully tracked`}
    >
      <View style={{ width, height, pointerEvents: "none" }}>
        <Svg width={width} height={height}>
          {MONTH_LABELS.map((label, month) => (
            <SvgText
              key={month}
              x={0}
              y={month * pitch + cell - 1}
              fontSize={Math.min(10, cell + 1)}
              fill={resolved.secondaryLabel}
            >
              {label}
            </SvgText>
          ))}
          {cells.map((day) => (
            <Rect
              key={day.iso}
              x={day.x}
              y={day.y}
              width={cell}
              height={cell}
              rx={1.5}
              fill={day.fill}
              opacity={day.opacity}
            />
          ))}
        </Svg>
      </View>
    </Pressable>
  );
}
