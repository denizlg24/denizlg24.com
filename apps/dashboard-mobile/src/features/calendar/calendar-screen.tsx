import {
  colors,
  HeaderButton,
  Row,
  Section,
  Stat,
  spacing,
  Text,
} from "@repo/native-ui";
import type { ISemesterOverview } from "@repo/schemas";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import {
  AGENDA_DAYS,
  agendaRange,
  useCalendarEvents,
  useSemesterOverview,
  useTimetable,
} from "@/api/calendar";
import { Segments } from "@/features/shell/segments";
import { Dash, QueryState, TabPage } from "@/features/shell/tab-page";
import { clock, dayLabel } from "@/lib/format";
import { type AgendaDay, type AgendaRow, buildAgendaDays } from "./agenda";

type View_ = "agenda" | "courses";

export function CalendarScreen() {
  const params = useLocalSearchParams<{ view?: string }>();
  const router = useRouter();
  const view: View_ = params.view === "courses" ? "courses" : "agenda";
  const events = useCalendarEvents();
  const timetable = useTimetable();
  const overview = useSemesterOverview();

  return (
    <TabPage
      title="Calendar"
      actions={
        <HeaderButton
          symbol="plus"
          label="New event"
          onPress={() => router.push("/event")}
        />
      }
      onRefresh={() => {
        void events.refetch();
        void timetable.refetch();
        void overview.refetch();
      }}
      refreshing={events.isRefetching}
    >
      <Segments
        value={view}
        onChange={(next) => router.setParams({ view: next })}
        options={[
          { value: "agenda", label: "Agenda" },
          {
            value: "courses",
            label: "Courses",
            count: overview.data?.stats.dueNext7Days,
          },
        ]}
      />
      {view === "agenda" ? (
        <>
          <QueryState
            error={events.error ?? timetable.error}
            loading={!events.data || !timetable.data}
          />
          {events.data && timetable.data ? (
            <Agenda
              days={buildAgendaDays({
                events: events.data,
                timetable: timetable.data,
                deadlines: overview.data?.deadlines ?? [],
                from: agendaRange().start,
                days: AGENDA_DAYS,
              })}
            />
          ) : null}
        </>
      ) : (
        <>
          <QueryState error={overview.error} loading={!overview.data} />
          {overview.data ? <Courses overview={overview.data} /> : null}
        </>
      )}
    </TabPage>
  );
}

function Agenda({ days }: { days: AgendaDay[] }) {
  // Empty days after today collapse into the next one that has something.
  const shown = days.filter((day, index) => index === 0 || day.rows.length > 0);
  return (
    <View style={{ gap: spacing.xl }}>
      {shown.map((day) => (
        <Section
          key={day.key}
          title={`${dayLabel(day.date)} · ${day.date.getDate()}/${day.date.getMonth() + 1}`}
        >
          {day.rows.length === 0 ? (
            <Dash />
          ) : (
            day.rows.map((row, index) => (
              <AgendaLine
                key={row.key}
                row={row}
                last={index === day.rows.length - 1}
              />
            ))
          )}
        </Section>
      ))}
    </View>
  );
}

function AgendaLine({ row, last }: { row: AgendaRow; last: boolean }) {
  const router = useRouter();
  const time = row.allDay
    ? "All day"
    : row.start
      ? `${clock(row.start)}${row.end ? `–${clock(row.end)}` : ""}`
      : "";
  const onPress =
    row.kind === "event"
      ? () => router.push(`/event?id=${row.eventId}`)
      : row.kind === "due"
        ? () => router.push(`/calendar/course/${row.courseId}`)
        : undefined;
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.line,
        !last && styles.separated,
        pressed && { opacity: 0.55 },
      ]}
    >
      <Text
        variant="footnote"
        tone={row.kind === "due" ? "destructive" : "secondary"}
        figure
        style={styles.time}
      >
        {row.kind === "due" ? `Due ${row.start ? clock(row.start) : ""}` : time}
      </Text>
      <View style={styles.text}>
        <Text variant="body" numberOfLines={2}>
          {row.title}
        </Text>
        {row.place || row.detail ? (
          <Text variant="footnote" tone="secondary" numberOfLines={1}>
            {row.place ?? row.detail}
          </Text>
        ) : null}
      </View>
      {row.kind === "class" ? <View style={styles.classMark} /> : null}
    </Pressable>
  );
}

function grade(value: number | null) {
  return value === null ? "—" : value.toFixed(1);
}

function Courses({ overview }: { overview: ISemesterOverview }) {
  const router = useRouter();
  return (
    <View style={{ gap: spacing.xl }}>
      <View style={styles.stats}>
        <Stat label="Average" value={grade(overview.stats.semesterAverage)} />
        <Stat label="Open" value={String(overview.stats.openAssessments)} />
        <Stat label="7 days" value={String(overview.stats.dueNext7Days)} />
        <Stat label="Overdue" value={String(overview.stats.overdue)} />
      </View>
      <Section title="Courses">
        {overview.courses.length === 0 ? <Dash /> : null}
        {overview.courses.map((course) => (
          <Row
            key={course.courseId}
            title={
              course.code ? `${course.code} · ${course.name}` : course.name
            }
            subtitle={
              course.nextDeadline
                ? `${course.nextDeadline.title} · ${dayLabel(course.nextDeadline.dueAt)}`
                : undefined
            }
            value={grade(course.gradeAverage)}
            chevron
            onPress={() => router.push(`/calendar/course/${course.courseId}`)}
          />
        ))}
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  separated: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  time: { width: 92, paddingTop: 2 },
  text: { flex: 1, gap: 2 },
  classMark: {
    width: 3,
    alignSelf: "stretch",
    borderRadius: 2,
    backgroundColor: colors.tertiaryLabel,
  },
  stats: { flexDirection: "row", gap: spacing.md },
});
