import React from "react";
import { Skeleton } from "@/components/ui/skeleton";

interface ContributionDay {
  date: string;
  contributionCount: number;
  contributionLevel:
    | "NONE"
    | "FIRST_QUARTILE"
    | "SECOND_QUARTILE"
    | "THIRD_QUARTILE"
    | "FOURTH_QUARTILE";
}

interface ContributionData {
  totalContributions: number;
  weeks: { contributionDays: ContributionDay[] }[];
}

const LEVEL_COLORS: Record<ContributionDay["contributionLevel"], string> = {
  NONE: "bg-background border border-border",
  FIRST_QUARTILE: "bg-muted",
  SECOND_QUARTILE: "bg-accent",
  THIRD_QUARTILE: "bg-accent-foreground",
  FOURTH_QUARTILE: "bg-primary",
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEK_COUNT = 53;

function ContributionGrid({ data }: { data: ContributionData }) {
  const { weeks, totalContributions } = data;

  const normalizedWeeks = weeks.map((week) => {
    const days: (ContributionDay | null)[] = Array(7).fill(null);
    for (const day of week.contributionDays) {
      const dow = new Date(`${day.date}T00:00:00`).getDay();
      days[dow] = day;
    }
    return days;
  });

  const monthLabels = new Map<number, string>();
  let lastMonth = "";
  normalizedWeeks.forEach((days, weekIndex) => {
    const firstDay = days.find((d) => d !== null);
    if (!firstDay) return;
    const month = firstDay.date.slice(5, 7);
    if (month !== lastMonth) {
      lastMonth = month;
      monthLabels.set(
        weekIndex,
        new Date(`${firstDay.date}T00:00:00`).toLocaleString("default", {
          month: "short",
        }),
      );
    }
  });

  const weekCount = normalizedWeeks.length;

  return (
    <div className="w-full max-w-fit mx-auto">
      <div className="overflow-x-auto pb-2">
        <div
          className="grid gap-px w-max"
          style={{
            gridTemplateColumns: `2rem repeat(${weekCount}, 12px)`,
            gridTemplateRows: `auto repeat(7, 12px)`,
          }}
        >
          <div className="sticky left-0 z-10 bg-background" />
          {normalizedWeeks.map((_, i) => (
            <div
              key={i}
              className="text-xs text-muted-foreground overflow-visible whitespace-nowrap"
            >
              {monthLabels.get(i) ?? ""}
            </div>
          ))}

          {Array.from({ length: 7 }, (_, dayIndex) => (
            <React.Fragment key={dayIndex}>
              <div className="sticky left-0 z-10 bg-background text-xs text-muted-foreground flex items-center justify-end pr-1">
                {dayIndex % 2 === 1 ? DAY_LABELS[dayIndex] : ""}
              </div>
              {normalizedWeeks.map((days, weekIndex) => {
                const day = days[dayIndex];
                if (!day) return <div key={weekIndex} />;
                return (
                  <div
                    key={weekIndex}
                    className={`${LEVEL_COLORS[day.contributionLevel]}`}
                    title={`${day.contributionCount} contributions on ${day.date}`}
                  />
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        {totalContributions.toLocaleString()} contributions in the last year
      </p>
    </div>
  );
}

export function GitHubContributionsSkeleton() {
  return (
    <div className="w-full max-w-fit mx-auto">
      <div className="overflow-x-auto">
        <div
          className="grid gap-px w-max pb-2"
          style={{
            gridTemplateColumns: `2rem repeat(${WEEK_COUNT}, 12px)`,
            gridTemplateRows: `auto repeat(7, 12px)`,
          }}
        >
          <div className="sticky left-0 z-10 bg-background" />
          {Array.from({ length: WEEK_COUNT }, (_, i) => (
            <div key={i} className="h-4" />
          ))}
          {Array.from({ length: 7 }, (_, dayIndex) => (
            <React.Fragment key={dayIndex}>
              <div className="sticky left-0 z-10 bg-background text-xs text-muted-foreground flex items-center justify-end pr-1">
                {dayIndex % 2 === 1 ? DAY_LABELS[dayIndex] : ""}
              </div>
              {Array.from({ length: WEEK_COUNT }, (_, weekIndex) => (
                <Skeleton className="rounded-none bg-surface" key={weekIndex} />
              ))}
            </React.Fragment>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        - contributions in the last year
      </p>
    </div>
  );
}

export async function GitHubContributions() {
  const result = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    },
    body: JSON.stringify({
      query: `
        query ($username: String!) {
          user(login: $username) {
            contributionsCollection {
              contributionCalendar {
                totalContributions
                weeks {
                  contributionDays {
                    date
                    contributionCount
                    contributionLevel
                  }
                }
              }
            }
          }
        }
      `,
      variables: { username: "denizlg24" },
    }),
  });

  const json = await result.json();
  const data: ContributionData =
    json.data.user.contributionsCollection.contributionCalendar;

  return <ContributionGrid data={data} />;
}
