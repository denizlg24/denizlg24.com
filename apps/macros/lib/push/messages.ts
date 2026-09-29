const KJ_PER_KCAL = 4.184;
const LB_PER_KG = 2.2046226218;

export type PushKind = "weekly-summary" | "streak-nudge";

export type PushMessage = {
  kind: PushKind;
  title: string;
  body: string;
};

export type ApnsPayload = {
  aps: {
    alert: { title: string; body: string };
    sound: "default";
    "thread-id": PushKind;
  };
  kind: PushKind;
};

export function buildApnsPayload(message: PushMessage): ApnsPayload {
  return {
    aps: {
      alert: { title: message.title, body: message.body },
      sound: "default",
      "thread-id": message.kind,
    },
    kind: message.kind,
  };
}

function formatEnergy(kcal: number, unit: string): string {
  return unit === "kj"
    ? `${Math.round(kcal * KJ_PER_KCAL)} kJ`
    : `${Math.round(kcal)} kcal`;
}

function formatWeightDelta(kg: number, unit: string): string {
  const value = unit === "lb" ? kg * LB_PER_KG : kg;
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "±";
  return `${sign}${Math.abs(rounded).toFixed(1)} ${unit === "lb" ? "lb" : "kg"}`;
}

export type WeeklySummaryFacts = {
  daysLogged: number;
  averageCalories: number | null;
  calorieTarget: number | null;
  trendChangeKg: number | null;
  energyUnit: string;
  weightUnit: string;
};

export function weeklySummaryMessage(facts: WeeklySummaryFacts): PushMessage {
  if (facts.daysLogged === 0) {
    return {
      kind: "weekly-summary",
      title: "Your week",
      body: "Nothing logged last week. A new week starts today.",
    };
  }

  const parts = [
    `Logged ${facts.daysLogged} of 7 days`,
    facts.averageCalories == null
      ? null
      : facts.calorieTarget == null
        ? `${formatEnergy(facts.averageCalories, facts.energyUnit)} a day`
        : `${formatEnergy(facts.averageCalories, facts.energyUnit)} a day of ${formatEnergy(facts.calorieTarget, facts.energyUnit)}`,
    facts.trendChangeKg == null
      ? null
      : `trend ${formatWeightDelta(facts.trendChangeKg, facts.weightUnit)}`,
  ].filter((part): part is string => part !== null);

  return {
    kind: "weekly-summary",
    title: "Your week",
    body: parts.join(" · "),
  };
}

export function streakNudgeMessage(): PushMessage {
  return {
    kind: "streak-nudge",
    title: "Nothing logged today",
    body: "You logged yesterday. Add what you've eaten today to keep going.",
  };
}
