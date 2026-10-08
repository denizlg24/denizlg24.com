import {
  MACROS_REPORT_NOTE_MAX,
  type MacrosFoodReportReason,
  macrosFoodReportReasonLabels,
  macrosFoodReportReasons,
} from "@repo/schemas/macros";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Keyboard, StyleSheet, View } from "react-native";
import { useReportFood } from "@/api/moderation";
import { errorMessage } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import {
  Button,
  Icon,
  InlineNotice,
  Row,
  Section,
  SheetHeader,
  sheetGutter,
  spacing,
  Text,
  TextField,
  VStack,
} from "@/ui";
import { colors } from "@/ui/theme";
import { readParam } from "./target";

export function ReportFoodSheet() {
  const params = useLocalSearchParams();
  const id = readParam(params.id);
  const name = readParam(params.name) ?? "this food";
  const report = useReportFood();
  const [reason, setReason] = useState<MacrosFoodReportReason | null>(null);
  const [note, setNote] = useState("");

  function submit() {
    if (!id || !reason || report.isPending) return;
    Keyboard.dismiss();
    report.mutate(
      { id, reason, note: note.trim() || undefined },
      {
        onSuccess: () => haptics.success(),
        onError: () => haptics.error(),
      },
    );
  }

  if (report.isSuccess) {
    return (
      <View style={styles.sheet}>
        <VStack gap={spacing.sm}>
          <Text variant="headline">Report sent</Text>
          <Text variant="subheadline" tone="secondary">
            {name} won’t appear in your searches any more. Reports are reviewed
            within 24 hours, and foods that break the rules are removed for
            everyone.
          </Text>
        </VStack>
        {/* Closes this sheet and the food it was about. */}
        <Button label="Done" onPress={() => router.dismiss(2)} />
      </View>
    );
  }

  return (
    <View style={styles.sheet}>
      <SheetHeader
        title="Report food"
        subtitle={name}
        onClose={() => router.back()}
      />

      <Section title="What’s wrong">
        {macrosFoodReportReasons.map((option, index) => (
          <Row
            key={option}
            title={macrosFoodReportReasonLabels[option]}
            separator={index < macrosFoodReportReasons.length - 1}
            accessibilityRole="radio"
            accessibilityState={{ selected: reason === option }}
            trailing={
              reason === option ? (
                <Icon name="check" size={18} color={colors.tint} />
              ) : null
            }
            onPress={() => {
              haptics.selection();
              setReason(option);
            }}
          />
        ))}
      </Section>

      <TextField
        label="Details (optional)"
        value={note}
        onChangeText={setNote}
        maxLength={MACROS_REPORT_NOTE_MAX}
        multiline
        hint="Don’t include your own personal information."
        editable={!report.isPending}
      />

      <VStack gap={spacing.sm}>
        {report.isError ? (
          <InlineNotice tone="error" message={errorMessage(report.error)} />
        ) : null}
        <Button
          label="Send Report"
          loading={report.isPending}
          disabled={!reason || !id}
          onPress={submit}
        />
      </VStack>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    paddingHorizontal: sheetGutter,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
});
