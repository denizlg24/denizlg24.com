import { MenuView } from "@expo/ui/community/menu";
import type { MacrosBodyMeasurementSite } from "@repo/schemas/macros";
import { endOfDay, format, parseISO } from "date-fns";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useAddMeasurement, useBodyOverview } from "@/api/body";
import { useProfile } from "@/api/profile";
import { useToday } from "@/lib/day";
import { formatDayLabel, formatDecimal } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { parseDecimal } from "@/lib/numbers";
import { Button, colors, gutter, Icon, spacing, Text, TextField } from "@/ui";
import { DateTimePicker } from "@/ui/date-time-picker";
import { SegmentedControl } from "@/ui/segmented-control";
import { NoticeSlot, useNotice } from "../shared/notice";
import {
  isMeasurementSite,
  MEASUREMENT_SITES,
  siteLabel,
} from "./measurement-sites";

const LENGTH_UNITS = ["cm", "in"] as const;
type LengthUnit = (typeof LENGTH_UNITS)[number];

export function MeasurementSheet() {
  const params = useLocalSearchParams<{ site?: string }>();
  const router = useRouter();
  const profile = useProfile();
  const today = useToday(profile.data?.timezone);
  const overview = useBodyOverview();
  const addMeasurement = useAddMeasurement();
  const { notice, showError, clear } = useNotice();

  const [site, setSite] = useState<MacrosBodyMeasurementSite>(
    isMeasurementSite(params.site) ? params.site : "waist",
  );
  const [lengthUnit, setLengthUnit] = useState<LengthUnit>(
    profile.data?.weightUnit === "lb" ? "in" : "cm",
  );
  const [value, setValue] = useState("");
  const [day, setDay] = useState(() => parseISO(today));

  const isPercent = site === "body_fat";
  const unit = isPercent ? "%" : lengthUnit;
  const parsed = parseDecimal(value);
  const valid =
    parsed !== null && parsed > 0 && parsed <= (isPercent ? 75 : 500);
  const last = [...(overview.data?.measurements ?? [])]
    .reverse()
    .find((entry) => entry.site === site);
  const logDate = format(day, "yyyy-MM-dd");

  function save() {
    if (!valid || parsed === null) return;
    clear();
    addMeasurement.mutate(
      { logDate, site, value: parsed, unit },
      {
        onSuccess: () => {
          haptics.success();
          router.back();
        },
        onError: showError,
      },
    );
  }

  return (
    <View style={styles.sheet}>
      <Text variant="headline">New measurement</Text>

      <MenuView
        title="Measure"
        actions={MEASUREMENT_SITES.map((entry) => ({
          id: entry.value,
          title: entry.label,
          state: entry.value === site ? "on" : "off",
        }))}
        onPressAction={({ nativeEvent }) => {
          if (!isMeasurementSite(nativeEvent.event)) return;
          haptics.selection();
          setSite(nativeEvent.event);
        }}
      >
        <View
          style={styles.menuRow}
          accessibilityRole="button"
          accessibilityLabel={`Site, ${siteLabel(site)}`}
        >
          <Text variant="body">Site</Text>
          <View style={styles.menuValue}>
            <Text variant="body" tone="secondary">
              {siteLabel(site)}
            </Text>
            <Icon
              name="chevrons-up-down"
              size={13}
              color={colors.tertiaryLabel}
            />
          </View>
        </View>
      </MenuView>

      <TextField
        label={siteLabel(site)}
        value={value}
        onChangeText={setValue}
        keyboardType="decimal-pad"
        placeholder={last ? formatDecimal(last.value) : "0"}
        suffix={unit}
        autoFocus
        hint={
          last
            ? `Last: ${formatDecimal(last.value)} ${last.unit} on ${formatDayLabel(last.logDate, today)}`
            : isPercent
              ? "An estimate from a scale or calipers."
              : "Measure at the same spot each time, tape snug but not tight."
        }
      />

      {isPercent ? null : (
        <SegmentedControl
          values={[...LENGTH_UNITS]}
          selectedIndex={LENGTH_UNITS.indexOf(lengthUnit)}
          onChange={(event) => {
            const next = LENGTH_UNITS[event.nativeEvent.selectedSegmentIndex];
            if (!next) return;
            haptics.selection();
            setLengthUnit(next);
          }}
        />
      )}

      <View style={styles.dateRow}>
        <Text variant="body">{formatDayLabel(logDate, today)}</Text>
        <DateTimePicker
          value={day}
          mode="date"
          display="compact"
          maximumDate={endOfDay(parseISO(today))}
          onValueChange={(_event, date) => {
            haptics.selection();
            setDay(date);
          }}
        />
      </View>

      <NoticeSlot notice={notice} onDismiss={clear} />

      <Button
        label="Save"
        disabled={!valid}
        loading={addMeasurement.isPending}
        onPress={save}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    paddingHorizontal: gutter,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
  },
  menuValue: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
});
