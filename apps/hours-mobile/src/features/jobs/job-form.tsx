import type { WorkJob } from "@repo/schemas";
import { majorToMinor, minorToMajor } from "@repo/utils";
import { useState } from "react";
import { StyleSheet, Switch, View } from "react-native";
import { useSaveJob } from "@/api/hours";
import { haptics } from "@/lib/haptics";
import {
  Button,
  colors,
  Field,
  Hairline,
  Notice,
  parseDecimal,
  spacing,
  Text,
} from "@/ui";

function deviceTimezone() {
  return (
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Copenhagen"
  );
}

export function JobForm({
  job,
  onSaved,
}: {
  job: WorkJob | null;
  onSaved?: () => void;
}) {
  const save = useSaveJob();
  const [name, setName] = useState(job?.name ?? "");
  const [currency, setCurrency] = useState(job?.currency ?? "DKK");
  const [rate, setRate] = useState(
    job ? String(minorToMajor(job.hourlyRateMinor, job.currency)) : "",
  );
  const [weekly, setWeekly] = useState(
    job?.expectedWeeklyHours !== undefined
      ? String(job.expectedWeeklyHours)
      : "",
  );
  const [breaksPaid, setBreaksPaid] = useState(job?.breaksPaid ?? false);
  const [timezone, setTimezone] = useState(job?.timezone ?? deviceTimezone());
  const rateValue = parseDecimal(rate);
  const currencyCode = currency.trim().toUpperCase();
  const ready =
    name.trim() !== "" && rateValue !== null && /^[A-Z]{3}$/.test(currencyCode);

  function submit() {
    if (!ready || rateValue === null) return;
    const weeklyValue = parseDecimal(weekly);
    const fields = {
      name: name.trim(),
      currency: currencyCode,
      hourlyRateMinor: Math.max(0, majorToMinor(rateValue, currencyCode)),
      breaksPaid,
      timezone: timezone.trim() || deviceTimezone(),
    };
    save.mutate(
      job
        ? { id: job.id, patch: { ...fields, expectedWeeklyHours: weeklyValue } }
        : {
            create: {
              ...fields,
              ...(weeklyValue !== null
                ? { expectedWeeklyHours: weeklyValue }
                : {}),
            },
          },
      {
        onSuccess: () => {
          haptics.success();
          onSaved?.();
        },
        onError: () => haptics.error(),
      },
    );
  }

  return (
    <View style={{ gap: spacing.lg }}>
      <View>
        <Field
          label="Job"
          value={name}
          onChangeText={setName}
          placeholder="Pandora"
          autoCapitalize="words"
        />
        <Field
          label="Hourly rate"
          value={rate}
          onChangeText={setRate}
          placeholder="0.00"
          keyboardType="decimal-pad"
          figure
        />
        <Field
          label="Currency"
          value={currency}
          onChangeText={setCurrency}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={3}
        />
        <Field
          label="Hours / week"
          value={weekly}
          onChangeText={setWeekly}
          placeholder="—"
          keyboardType="decimal-pad"
          figure
        />
        <Field
          label="Timezone"
          value={timezone}
          onChangeText={setTimezone}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={styles.toggle}>
          <Text variant="body">Paid breaks</Text>
          <Switch
            value={breaksPaid}
            onValueChange={(value) => {
              haptics.selection();
              setBreaksPaid(value);
            }}
            trackColor={{ true: colors.working }}
          />
        </View>
        <Hairline />
      </View>
      {save.error ? <Notice message={save.error.message} /> : null}
      <Button
        label={job ? "Save job" : "Add job"}
        disabled={!ready}
        loading={save.isPending}
        onPress={submit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 48,
  },
});
