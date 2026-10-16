import {
  Button,
  colors,
  Field,
  Hairline,
  haptics,
  Notice,
  spacing,
  Text,
} from "@repo/native-ui";
import { CompactPicker } from "@repo/native-ui/time-picker";
import type { CalendarEventWrite, ICalendarEvent } from "@repo/schemas";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  Button as HeaderAction,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import {
  useCalendarEvents,
  useDeleteEvent,
  useSaveEvent,
} from "@/api/calendar";
import { isoDay } from "@/lib/format";

function nextHour() {
  const date = new Date();
  date.setHours(date.getHours() + 1, 0, 0, 0);
  return date;
}

/** Date part of `day`, time part of `time`. */
function combine(day: Date, time: Date) {
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    time.getHours(),
    time.getMinutes(),
  );
}

function initialStart(event: ICalendarEvent | undefined) {
  if (!event) return nextHour();
  if (event.isAllDay) return new Date(`${event.calendarDate}T09:00:00`);
  return new Date(event.date);
}

/** Google sync stays on the server: saving here is all it takes. */
export default function EventSheet() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const events = useCalendarEvents();
  const existing = id
    ? events.data?.find((event) => event._id === id)
    : undefined;

  if (id && !existing) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: "Event" }} />
        {events.error ? <Notice message={events.error.message} /> : null}
        <Text tone="tertiary" align="center" style={{ padding: spacing.xxl }}>
          —
        </Text>
      </View>
    );
  }
  return <EventForm key={id ?? "new"} id={id} existing={existing} />;
}

function EventForm({
  id,
  existing,
}: {
  id: string | undefined;
  existing: ICalendarEvent | undefined;
}) {
  const router = useRouter();
  const save = useSaveEvent();
  const remove = useDeleteEvent();

  const [title, setTitle] = useState(existing?.title ?? "");
  const [place, setPlace] = useState(existing?.place ?? "");
  const [allDay, setAllDay] = useState(existing?.isAllDay ?? false);
  const [start, setStart] = useState(() => initialStart(existing));
  const [end, setEnd] = useState<Date | null>(() =>
    existing?.endDate ? new Date(existing.endDate) : null,
  );

  const submit = () => {
    const event: CalendarEventWrite = allDay
      ? {
          title: title.trim(),
          isAllDay: true,
          calendarDate: isoDay(start),
          place: place.trim() || undefined,
          endDate: null,
        }
      : {
          title: title.trim(),
          isAllDay: false,
          date: start.toISOString(),
          endDate: end && end > start ? end.toISOString() : null,
          place: place.trim() || undefined,
        };
    save.mutate(
      { id, event },
      {
        onSuccess: () => {
          haptics.success();
          router.back();
        },
      },
    );
  };

  const confirmDelete = () =>
    Alert.alert("Delete event?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          id &&
          remove.mutate(id, {
            onSuccess: () => {
              haptics.warning();
              router.back();
            },
          }),
      },
    ]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen
        options={{
          title: id ? "Event" : "New event",
          headerRight: () => (
            <HeaderAction
              title="Save"
              disabled={!title.trim() || save.isPending}
              onPress={submit}
            />
          ),
        }}
      />
      {save.error ? <Notice message={save.error.message} /> : null}
      {remove.error ? <Notice message={remove.error.message} /> : null}
      <Field
        label="Title"
        value={title}
        onChangeText={setTitle}
        autoFocus={!id}
      />
      <Field label="Place" value={place} onChangeText={setPlace} />
      <View style={styles.row}>
        <Text style={styles.label}>All day</Text>
        <Switch value={allDay} onValueChange={setAllDay} />
      </View>
      <Hairline />
      <View style={styles.row}>
        <Text style={styles.label}>{allDay ? "Day" : "Starts"}</Text>
        <CompactPicker
          mode="date"
          value={start}
          onChange={(day) => setStart(combine(day, start))}
        />
        {allDay ? null : (
          <CompactPicker
            value={start}
            onChange={(time) => setStart(combine(start, time))}
          />
        )}
      </View>
      <Hairline />
      {allDay ? null : (
        <>
          <View style={styles.row}>
            <Text style={styles.label}>Ends</Text>
            {end ? (
              <>
                <CompactPicker
                  value={end}
                  onChange={(time) => setEnd(combine(start, time))}
                />
                <Button
                  label="None"
                  variant="plain"
                  size="small"
                  block={false}
                  onPress={() => setEnd(null)}
                />
              </>
            ) : (
              <Button
                label="Add"
                variant="plain"
                size="small"
                block={false}
                onPress={() => setEnd(new Date(start.getTime() + 60 * 60_000))}
              />
            )}
          </View>
          <Hairline />
        </>
      )}
      {id ? (
        <Button
          label="Delete"
          variant="destructive"
          loading={remove.isPending}
          onPress={confirmDelete}
          style={{ marginTop: spacing.xxl }}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 52,
  },
  label: { flex: 1 },
});
