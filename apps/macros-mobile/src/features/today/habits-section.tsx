import type { MacrosDashboardHabit } from "@repo/schemas/macros";
import { useState } from "react";
import { useSetHabitCompletion } from "@/api/habits";
import { habitStatus } from "@/features/more/habits/habit-dates";
import { HabitGlyph } from "@/features/more/habits/habit-glyph";
import { errorMessage } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import { colors, Icon, InlineNotice, Row, Section } from "@/ui";

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
    // Ticking the last habit due today gets the goal haptic, like a target.
    const closesTheDay =
      completed &&
      habits.every((other) => {
        if (other.id === habit.id) return true;
        const status = habitStatus(other, logDate);
        return status.done || !status.due;
      });
    if (closesTheDay) haptics.goalReached();
    else if (completed) haptics.success();
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
        const status = habitStatus(habit, logDate);
        const progress = `${status.week} of ${status.weekTarget} this week`;
        const subtitle = [
          status.due || status.done ? null : "Rest day",
          progress,
          status.streak > 1 ? `${status.streak}-day streak` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <Row
            key={habit.id}
            title={habit.name}
            subtitle={subtitle}
            leading={
              <HabitGlyph
                icon={habit.icon}
                size={20}
                color={
                  status.due ? colors.secondaryLabel : colors.tertiaryLabel
                }
              />
            }
            trailing={
              <Icon
                name={status.done ? "circle-check" : "circle"}
                size={26}
                color={
                  status.done
                    ? colors.label
                    : status.due
                      ? colors.secondaryLabel
                      : colors.tertiaryLabel
                }
              />
            }
            separator={index < habits.length - 1}
            onPress={() => toggle(habit, status.done)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: status.done }}
            accessibilityLabel={`${habit.name}, ${subtitle}`}
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
