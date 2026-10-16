import {
  Stack as Gap,
  Row,
  Screen,
  Section,
  Stat,
  spacing,
  Text,
} from "@repo/native-ui";
import type { ICourseAssignment } from "@repo/schemas";
import { Stack } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { StyleSheet, View } from "react-native";
import { useCourse } from "@/api/calendar";
import { Dash, QueryState } from "@/features/shell/tab-page";
import { clock, dayLabel } from "@/lib/format";

function score(assignment: ICourseAssignment) {
  const grade = assignment.grade;
  if (!grade) return undefined;
  if (grade.letter) return grade.letter;
  if (grade.score === undefined) return undefined;
  return grade.maxScore
    ? `${grade.score}/${grade.maxScore}`
    : String(grade.score);
}

const fixed = (value: number | null) =>
  value === null ? "—" : value.toFixed(1);

/** Read-only: standing, what is due, what was graded. Editing stays on web. */
export function CourseScreen({ id }: { id: string }) {
  const course = useCourse(id);
  const detail = course.data;
  const open = (detail?.assignments ?? [])
    .filter((item) => item.status !== "graded" && item.status !== "archived")
    .sort((a, b) => (a.dueAt ?? "~").localeCompare(b.dueAt ?? "~"));
  const graded = (detail?.assignments ?? [])
    .filter((item) => item.status === "graded")
    .sort((a, b) =>
      (b.grade?.gradedAt ?? "").localeCompare(a.grade?.gradedAt ?? ""),
    );
  const links = detail
    ? [
        ...(detail.course.homepageUrl
          ? [
              {
                _id: "home",
                label: "Course page",
                url: detail.course.homepageUrl,
              },
            ]
          : []),
        ...detail.course.links,
      ]
    : [];

  return (
    <Screen
      onRefresh={() => void course.refetch()}
      refreshing={course.isRefetching}
    >
      <Stack.Screen
        options={{ title: detail?.course.code ?? detail?.course.name ?? "" }}
      />
      <QueryState error={course.error} loading={!detail} />
      {detail ? (
        <Gap>
          <View style={styles.head}>
            <Text variant="title2">{detail.course.name}</Text>
            {detail.course.instructorName || detail.course.location ? (
              <Text variant="subheadline" tone="secondary">
                {[detail.course.instructorName, detail.course.location]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            ) : null}
          </View>

          <View style={styles.stats}>
            <Stat
              label="Average"
              value={fixed(detail.projection.currentAverage)}
            />
            <Stat label="Best" value={fixed(detail.projection.bestCase)} />
            <Stat label="Worst" value={fixed(detail.projection.worstCase)} />
            <Stat
              label="Graded"
              value={
                detail.projection.gradedWeight === null
                  ? "—"
                  : `${Math.round(detail.projection.gradedWeight)}%`
              }
            />
          </View>

          <Section title="Open">
            {open.length === 0 ? <Dash /> : null}
            {open.map((item, index) => (
              <Row
                key={item._id}
                title={item.title}
                subtitle={[item.type, item.assessed ? "assessed" : null]
                  .filter(Boolean)
                  .join(" · ")}
                value={
                  item.dueAt
                    ? `${dayLabel(item.dueAt)} ${clock(item.dueAt)}`
                    : undefined
                }
                separator={index < open.length - 1}
              />
            ))}
          </Section>

          {graded.length > 0 ? (
            <Section title="Graded">
              {graded.map((item, index) => (
                <Row
                  key={item._id}
                  title={item.title}
                  subtitle={
                    item.grade?.weight !== undefined
                      ? `${item.grade.weight}%`
                      : undefined
                  }
                  value={score(item)}
                  valueTone="primary"
                  separator={index < graded.length - 1}
                />
              ))}
            </Section>
          ) : null}

          {links.length > 0 ? (
            <Section title="Links">
              {links.map((link, index) => (
                <Row
                  key={link._id}
                  title={link.label}
                  chevron
                  separator={index < links.length - 1}
                  onPress={() => void WebBrowser.openBrowserAsync(link.url)}
                />
              ))}
            </Section>
          ) : null}
        </Gap>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { gap: spacing.xs },
  stats: { flexDirection: "row", gap: spacing.md },
});
