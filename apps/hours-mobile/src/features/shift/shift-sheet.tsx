import type { WorkSession } from "@repo/schemas";
import { formatMinutes, formatMoney, sessionMinutes } from "@repo/utils";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { router, Stack } from "expo-router";
import { type ReactNode, useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from "react-native";
import { useDeleteSession, useOverview, useSaveSession } from "@/api/hours";
import { haptics } from "@/lib/haptics";
import { combine, localDay, onShift } from "@/lib/time";
import {
  Button,
  CompactPicker,
  colors,
  Hairline,
  Notice,
  Section,
  spacing,
  Text,
  typeScale,
} from "@/ui";

interface BreakDraft {
  key: string;
  start: Date;
  end: Date | null;
}

function at(hours: number, minutes = 0) {
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

/** The shift a row opened, wherever it was loaded from. */
function useSession(id: string | undefined): WorkSession | null {
  const client = useQueryClient();
  const overview = useOverview();
  if (!id) return null;
  if (overview.data?.active?.id === id) return overview.data.active;
  const recent = overview.data?.recent.find((row) => row.id === id);
  if (recent) return recent;
  for (const [, sessions] of client.getQueriesData<WorkSession[]>({
    queryKey: ["hours", "sessions"],
  })) {
    const found = sessions?.find((row) => row.id === id);
    if (found) return found;
  }
  return null;
}

export function ShiftSheet({ id }: { id?: string }) {
  const session = useSession(id);
  const overview = useOverview();
  const jobs = overview.data?.jobs ?? [];
  const save = useSaveSession();
  const remove = useDeleteSession();
  const start = session ? new Date(session.start) : null;
  const end = session?.end ? new Date(session.end) : null;
  const choosable = jobs.filter(
    (job) => job.status === "active" || job.id === session?.jobId,
  );

  const [jobId, setJobId] = useState(session?.jobId ?? choosable[0]?.id ?? "");
  const [day, setDay] = useState(() =>
    combine(localDay(start ?? new Date()), "12:00"),
  );
  const [startTime, setStartTime] = useState(start ?? at(9));
  const [endTime, setEndTime] = useState<Date | null>(
    end ?? (session ? null : at(17)),
  );
  const [breaks, setBreaks] = useState<BreakDraft[]>(() =>
    (session?.breaks ?? []).map((item, index) => ({
      key: String(index),
      start: new Date(item.start),
      end: item.end ? new Date(item.end) : null,
    })),
  );
  const [note, setNote] = useState(session?.note ?? "");

  const job = jobs.find((row) => row.id === jobId);
  const dayKey = localDay(day);
  const shiftStart = combine(dayKey, startTime);
  const shiftEnd = endTime ? onShift(dayKey, endTime, shiftStart) : undefined;
  const breakRows = breaks.map((item) => ({
    start: onShift(dayKey, item.start, shiftStart),
    end: item.end ? onShift(dayKey, item.end, shiftStart) : undefined,
  }));
  const preview = sessionMinutes(
    { start: shiftStart, end: shiftEnd, breaks: breakRows },
    job?.breaksPaid ?? false,
  );
  const overnight =
    Boolean(endTime) && combine(dayKey, endTime ?? startTime) < shiftStart;

  function submit() {
    if (!jobId) return;
    const breaksPayload = breakRows.map((item) => ({
      start: item.start.toISOString(),
      end: item.end?.toISOString(),
    }));
    save.mutate(
      session
        ? {
            id: session.id,
            patch: {
              jobId,
              start: shiftStart.toISOString(),
              end: shiftEnd ? shiftEnd.toISOString() : null,
              breaks: breaksPayload,
              note: note.trim() || null,
            },
          }
        : {
            create: {
              jobId,
              start: shiftStart.toISOString(),
              end: shiftEnd?.toISOString(),
              breaks: breaksPayload,
              note: note.trim() || undefined,
            },
          },
      {
        onSuccess: () => {
          haptics.success();
          router.back();
        },
        onError: () => haptics.error(),
      },
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: session
            ? format(new Date(`${session.day}T12:00:00`), "EEE d MMM")
            : "Shift",
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              disabled={save.isPending || !jobId}
              onPress={submit}
              hitSlop={10}
            >
              <Text variant="body" weight="semibold">
                {session ? "Save" : "Add"}
              </Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <View style={styles.summary}>
          <Text figure weight="semibold" style={styles.total}>
            {formatMinutes(preview.workedMinutes)}
            <Text variant="body" tone="secondary">
              {" "}
              h
            </Text>
          </Text>
          <View style={{ alignItems: "flex-end" }}>
            {job ? (
              <Text variant="subheadline" weight="semibold" figure>
                {formatMoney(
                  Math.round(
                    (preview.workedMinutes * job.hourlyRateMinor) / 60,
                  ),
                  job.currency,
                )}
              </Text>
            ) : null}
            <Text variant="caption1" tone="secondary" figure>
              {[
                !endTime ? "open" : undefined,
                overnight ? "ends next day" : undefined,
                preview.breakMinutes > 0
                  ? `break ${formatMinutes(preview.breakMinutes)}`
                  : undefined,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
        </View>

        <View>
          {choosable.length > 1 ? (
            <PickerRow
              label="Job"
              value={job?.name ?? "—"}
              onPress={() =>
                ActionSheetIOS.showActionSheetWithOptions(
                  {
                    options: [...choosable.map((row) => row.name), "Cancel"],
                    cancelButtonIndex: choosable.length,
                  },
                  (index) => {
                    const picked = choosable[index];
                    if (picked) setJobId(picked.id);
                  },
                )
              }
            />
          ) : null}
          <ControlRow label="Day">
            <CompactPicker
              mode="date"
              value={day}
              maximum={new Date()}
              onChange={setDay}
            />
          </ControlRow>
          <ControlRow label="Start">
            <CompactPicker value={startTime} onChange={setStartTime} />
          </ControlRow>
          <ControlRow label="End">
            <View style={styles.endControls}>
              {endTime ? (
                <CompactPicker value={endTime} onChange={setEndTime} />
              ) : (
                <Text variant="body" tone="secondary">
                  Open
                </Text>
              )}
              <Switch
                accessibilityLabel="Ended"
                value={endTime !== null}
                trackColor={{ true: colors.working }}
                onValueChange={(on) => {
                  haptics.selection();
                  setEndTime(on ? new Date() : null);
                }}
              />
            </View>
          </ControlRow>
        </View>

        <Section
          title="Breaks"
          trailing={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add break"
              hitSlop={10}
              onPress={() => {
                haptics.selection();
                setBreaks((current) => [
                  ...current,
                  {
                    key: Math.random().toString(36).slice(2),
                    start: at(12),
                    end: at(12, 30),
                  },
                ]);
              }}
            >
              <Text variant="footnote" weight="semibold">
                Add
              </Text>
            </Pressable>
          }
        >
          {breaks.map((item, index) => (
            <View key={item.key}>
              <View style={styles.breakRow}>
                <Text variant="body" figure style={{ flex: 1 }}>
                  {index + 1}
                </Text>
                <CompactPicker
                  value={item.start}
                  onChange={(value) =>
                    setBreaks((current) =>
                      current.map((row) =>
                        row.key === item.key ? { ...row, start: value } : row,
                      ),
                    )
                  }
                />
                <Text tone="secondary">–</Text>
                {item.end ? (
                  <CompactPicker
                    value={item.end}
                    onChange={(value) =>
                      setBreaks((current) =>
                        current.map((row) =>
                          row.key === item.key ? { ...row, end: value } : row,
                        ),
                      )
                    }
                  />
                ) : (
                  <Text tone="secondary">open</Text>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove break ${index + 1}`}
                  hitSlop={8}
                  onPress={() => {
                    haptics.warning();
                    setBreaks((current) =>
                      current.filter((row) => row.key !== item.key),
                    );
                  }}
                >
                  <Text tone="destructive" weight="semibold">
                    ×
                  </Text>
                </Pressable>
              </View>
              <Hairline />
            </View>
          ))}
        </Section>

        <Section title="Note">
          <TextInput
            value={note}
            onChangeText={setNote}
            multiline
            placeholderTextColor={colors.placeholder}
            style={[typeScale.body, styles.note, { color: colors.label }]}
          />
          <Hairline />
        </Section>

        {save.error ? <Notice message={save.error.message} /> : null}
        {remove.error ? <Notice message={remove.error.message} /> : null}

        {session ? (
          <Button
            label="Delete shift"
            variant="destructive"
            symbol="trash"
            loading={remove.isPending}
            onPress={() =>
              Alert.alert("Delete shift?", undefined, [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () =>
                    remove.mutate(session.id, {
                      onSuccess: () => {
                        haptics.warning();
                        router.back();
                      },
                    }),
                },
              ])
            }
          />
        ) : null}
      </ScrollView>
    </>
  );
}

function ControlRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <View>
      <View style={styles.controlRow}>
        <Text variant="body">{label}</Text>
        {children}
      </View>
      <Hairline />
    </View>
  );
}

function PickerRow({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      <ControlRow label={label}>
        <Text variant="body" tone="secondary">
          {value}
        </Text>
      </ControlRow>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: spacing.xxl },
  summary: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  total: { fontSize: 40, lineHeight: 46, letterSpacing: -0.5 },
  controlRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 50,
  },
  endControls: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  breakRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 50,
  },
  note: { minHeight: 44, paddingVertical: spacing.sm },
});
