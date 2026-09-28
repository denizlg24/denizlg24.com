import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, TextInput, View } from "react-native";
import { useDayNote, useFoodLogDay } from "@/api/food-log";
import { useProfile } from "@/api/profile";
import { errorMessage } from "@/lib/api";
import { deviceTimeZone, useToday } from "@/lib/day";
import { formatDayLabel, formatInteger } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { colors, gutter, InlineNotice, spacing, Text, typeScale } from "@/ui";
import { noteFlashKey } from "./day-note-row";
import { flashEntries } from "./flash";
import { isIsoDate } from "./selected-date";
import { SheetHeader } from "./sheet-header";

const NOTE_LIMIT = 2000;
const AFTER_DISMISS_MS = 420;

export function NoteSheet() {
  const router = useRouter();
  const params = useLocalSearchParams<{ date?: string }>();
  const profile = useProfile();
  const today = useToday(profile.data?.timezone ?? deviceTimeZone());
  const date = isIsoDate(params.date) ? params.date : today;
  const day = useFoodLogDay(date);
  const title = `Note · ${formatDayLabel(date, today)}`;

  // Saving replaces the stored note, so the editor waits for it rather than
  // starting blank and overwriting it.
  if (!day.data) {
    return (
      <View style={styles.sheet}>
        <SheetHeader title={title} onCancel={() => router.back()} />
        {day.isError ? (
          <InlineNotice
            message={errorMessage(day.error)}
            action={{ label: "Try again", onPress: () => void day.refetch() }}
            style={styles.notice}
          />
        ) : (
          <ActivityIndicator style={styles.loading} />
        )}
      </View>
    );
  }

  return <NoteEditor date={date} title={title} initial={day.data.note ?? ""} />;
}

function NoteEditor({
  date,
  title,
  initial,
}: {
  date: string;
  title: string;
  initial: string;
}) {
  const router = useRouter();
  const save = useDayNote(date);
  const [draft, setDraft] = useState(initial);
  const [notice, setNotice] = useState<string | null>(null);
  const changed = draft.trim() !== initial.trim();

  function submit() {
    if (!changed) {
      router.back();
      return;
    }
    setNotice(null);
    save.mutate(draft, {
      onSuccess: () => {
        haptics.success();
        flashEntries([noteFlashKey(date)], AFTER_DISMISS_MS);
        router.back();
      },
      onError: (error) => {
        haptics.error();
        setNotice(errorMessage(error));
      },
    });
  }

  return (
    <View style={styles.sheet}>
      <SheetHeader
        title={title}
        onCancel={() => router.back()}
        confirm={{ label: "Save", onPress: submit, busy: save.isPending }}
      />
      {notice ? (
        <InlineNotice
          message={notice}
          onDismiss={() => setNotice(null)}
          style={styles.notice}
        />
      ) : null}
      <View style={styles.editor}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          multiline
          autoFocus
          maxLength={NOTE_LIMIT}
          placeholder="How the day went, what was different…"
          placeholderTextColor={colors.placeholder}
          accessibilityLabel="Day note"
          style={styles.input}
        />
        {draft.length > NOTE_LIMIT * 0.9 ? (
          <Text variant="footnote" tone="secondary" figure align="right">
            {`${formatInteger(draft.length)} / ${formatInteger(NOTE_LIMIT)}`}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: colors.background,
  },
  notice: {
    paddingHorizontal: gutter,
  },
  loading: {
    paddingVertical: spacing.xxxl,
  },
  editor: {
    flex: 1,
    paddingHorizontal: gutter,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  input: {
    ...typeScale.body,
    flex: 1,
    color: colors.label,
    textAlignVertical: "top",
  },
});
