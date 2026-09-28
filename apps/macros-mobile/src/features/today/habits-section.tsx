import type { MacrosDashboardHabit } from "@repo/schemas/macros";
import { useState } from "react";
import { useSetHabitCompletion } from "@/api/habits";
import { errorMessage } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import { colors, Icon, InlineNotice, Row, Section } from "@/ui";
import { completionsThisWeek } from "./logic";

export interface HabitsSectionProps {
  habits: MacrosDashboardHabit[];
  /** The server's day — what a completion is recorded against. */
  logDate: string;
  onManage: () => void;
}

export function HabitsSection({
  habits,
  logDate,
  onManage,
}: HabitsSectionProps) {
  const completion = useSetHabitCompletion();
  const [failed, setFailed] = useState<{
    name: string;
    message: string;
  } | null>(null);

  if (habits.length === 0) {
    return (
      <Section title="Habits">
        <Row
          title="Add a habit"
          subtitle="Track things like steps, sleep or water alongside your food."
          icon="circle-plus"
          chevron
          separator={false}
          onPress={onManage}
        />
      </Section>
    );
  }

  function toggle(habit: MacrosDashboardHabit, done: boolean) {
    const completed = !done;
    if (completed) haptics.success();
    else haptics.light();
    setFailed(null);
    completion.mutate(
      { habitId: habit.id, logDate, completed },
      {
        onError: (error) => {
          haptics.error();
          setFailed({ name: habit.name, message: errorMessage(error) });
        },
      },
    );
  }

  return (
    <Section title="Habits" action={{ label: "Edit", onPress: onManage }}>
      {habits.map((habit, index) => {
        const done = habit.completedDates.includes(logDate);
        const count = completionsThisWeek(habit.completedDates, logDate);
        return (
          <Row
            key={habit.id}
            title={habit.name}
            subtitle={`${count} of ${habit.targetPerWeek} this week`}
            leading={
              <Icon
                name={done ? "circle-check" : "circle"}
                size={24}
                color={done ? colors.label : colors.tertiaryLabel}
              />
            }
            separator={index < habits.length - 1}
            onPress={() => toggle(habit, done)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: done }}
            accessibilityLabel={`${habit.name}, ${count} of ${habit.targetPerWeek} this week`}
          />
        );
      })}
      {failed ? (
        <InlineNotice
          message={`Couldn’t update “${failed.name}”. ${failed.message}`}
          onDismiss={() => setFailed(null)}
        />
      ) : null}
    </Section>
  );
}
