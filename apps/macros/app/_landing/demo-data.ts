export interface MacroAmounts {
  protein: number;
  carbs: number;
  fat: number;
}

export interface DemoFood extends MacroAmounts {
  id: string;
  name: string;
  amount: string;
  iconKey: string | null;
  calories: number;
}

export interface DemoEntry extends DemoFood {
  /** `HH:mm`, as an en-GB iPhone shows it. */
  time: string;
}

export const demoClock = "12:41";
export const demoPickerDate = "6 Oct 2026";
export const demoDateLine = "Tuesday 6 October";
export const demoMonth = "October 2026";

export const demoTargets = {
  calories: 2300,
  protein: 160,
  carbs: 245,
  fat: 76,
} as const;

/** The entry the demo logs, at the time on the status bar. */
export const justLogged: DemoEntry = {
  id: "chicken-rice",
  name: "Chicken & rice bowl",
  amount: "1 bowl",
  time: "12:40",
  iconKey: "meats-042",
  calories: 610,
  protein: 48,
  carbs: 72,
  fat: 14,
};

export const todaysEntries: DemoEntry[] = [
  {
    id: "oats",
    name: "Overnight oats",
    amount: "1 jar",
    time: "07:45",
    iconKey: "other-088",
    calories: 420,
    protein: 18,
    carbs: 62,
    fat: 11,
  },
  {
    id: "flat-white",
    name: "Flat white",
    amount: "240 ml",
    time: "07:55",
    iconKey: "other-082",
    calories: 110,
    protein: 6,
    carbs: 9,
    fat: 6,
  },
  justLogged,
];

export function sumMacros(entries: ReadonlyArray<DemoFood>) {
  return entries.reduce(
    (total, entry) => ({
      calories: total.calories + entry.calories,
      protein: total.protein + entry.protein,
      carbs: total.carbs + entry.carbs,
      fat: total.fat + entry.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

export const todaysTotals = sumMacros(todaysEntries);

/** The log's timeline: one group per hour something was eaten in. */
export const todaysHours: ReadonlyArray<{
  label: string;
  entries: DemoEntry[];
}> = (() => {
  const groups = new Map<string, DemoEntry[]>();
  for (const entry of todaysEntries) {
    const label = `${entry.time.slice(0, 2)}:00`;
    groups.set(label, [...(groups.get(label) ?? []), entry]);
  }
  return [...groups]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, entries]) => ({ label, entries }));
})();

export const suggestedFoods: DemoFood[] = [
  justLogged,
  {
    id: "greek-yogurt",
    name: "Greek yogurt, 0%",
    amount: "170 g",
    iconKey: "dairy-and-eggs-019",
    calories: 100,
    protein: 17,
    carbs: 6,
    fat: 1,
  },
  {
    id: "poke",
    name: "Salmon poke bowl",
    amount: "1 bowl",
    iconKey: "seafood-014",
    calories: 540,
    protein: 32,
    carbs: 58,
    fat: 18,
  },
  {
    id: "blueberries",
    name: "Blueberries",
    amount: "100 g",
    iconKey: "fruit-007",
    calories: 57,
    protein: 1,
    carbs: 14,
    fat: 0,
  },
];

export const savedMeal: DemoFood = {
  id: "toast-banana-coffee",
  name: "Toast, banana & coffee",
  amount: "3 foods",
  iconKey: "baked-goods-015",
  calories: 635,
  protein: 25,
  carbs: 98,
  fat: 17,
};

export const recipe: DemoFood = {
  id: "turkey-chilli",
  name: "Turkey chilli",
  amount: "1 serving",
  iconKey: null,
  calories: 480,
  protein: 42,
  carbs: 38,
  fat: 16,
};

export const demoHabits = [
  { id: "steps", name: "10,000 steps", done: true, count: 3, target: 5 },
  { id: "creatine", name: "Creatine", done: true, count: 5, target: 7 },
  { id: "read", name: "Read before bed", done: false, count: 2, target: 4 },
];

const energyDays = [
  { letter: "W", consumed: 2210, expenditure: 2700 },
  { letter: "T", consumed: 2350, expenditure: 2705 },
  { letter: "F", consumed: 2280, expenditure: 2705 },
  { letter: "S", consumed: 2690, expenditure: 2710 },
  { letter: "S", consumed: 2140, expenditure: 2715 },
  { letter: "M", consumed: 2260, expenditure: 2720 },
  { letter: "T", consumed: todaysTotals.calories, expenditure: 2720 },
];

const completedEnergyDays = energyDays.slice(0, -1);
// The demo is a cut, so a day is on target unless it ran over by more than 10%.
const onTargetDays = completedEnergyDays.filter(
  (day) => day.consumed <= demoTargets.calories * 1.1,
).length;

export const energySummary = {
  days: energyDays.map((day) => ({
    ...day,
    over: day.consumed > demoTargets.calories * 1.1,
  })),
  scale: 2900,
  deficit: completedEnergyDays.reduce(
    (total, day) => total + day.expenditure - day.consumed,
    0,
  ),
  daysTracked: completedEnergyDays.length,
  daysOnTarget: onTargetDays,
};

export const weekStrip = [
  { letter: "M", day: 5, calories: 2260, today: false, future: false },
  {
    letter: "T",
    day: 6,
    calories: todaysTotals.calories,
    today: true,
    future: false,
  },
  { letter: "W", day: 7, calories: 0, today: false, future: true },
  { letter: "T", day: 8, calories: 0, today: false, future: true },
  { letter: "F", day: 9, calories: 0, today: false, future: true },
  { letter: "S", day: 10, calories: 0, today: false, future: true },
  { letter: "S", day: 11, calories: 0, today: false, future: true },
];

function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number) {
  const u = Math.max(random(), Number.EPSILON);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface WeightPoint {
  day: number;
  trend: number;
  scale: number | null;
  band: number;
}

const WEIGHT_DAYS = 91;
const START_KG = 83.4;
const LOST_KG = 5;
const TODAY_WEEKDAY = 2;

/** Three months of weigh-ins ending today, generated from a fixed seed. */
export const weightSeries: WeightPoint[] = (() => {
  const random = seededRandom(20261006);
  const last = WEIGHT_DAYS - 1;
  return Array.from({ length: WEIGHT_DAYS }, (_, day) => {
    const progress = day / last;
    const trend = START_KG - LOST_KG * progress ** 1.08;
    const weekday = (((TODAY_WEEKDAY + day - last) % 7) + 7) % 7;
    const weighed = day === last || random() < 0.74;
    const noise = gaussian(random) * 0.38 + (weekday === 1 ? 0.35 : 0);
    const scale =
      day === last
        ? 78.1
        : weighed
          ? Math.round((trend + noise) * 10) / 10
          : null;
    return { day, trend, scale, band: 0.78 - 0.4 * progress };
  });
})();

export const weightGoalKg = 75;

export const weightMonths = [
  { label: "Aug", day: 24 },
  { label: "Sep", day: 55 },
  { label: "Oct", day: 85 },
];

export const weightStats = {
  trend: "78.4",
  weekly: "−0.42",
  change: "−5.0",
};

export interface ExpenditurePoint {
  day: number;
  tdee: number;
  low: number;
  high: number;
  intake: number;
}

/** The last 28 days of estimated expenditure and intake. */
export const expenditureSeries: ExpenditurePoint[] = (() => {
  const random = seededRandom(2720);
  const last = 27;
  return Array.from({ length: 28 }, (_, day) => {
    const progress = day / last;
    const tdee = 2660 + 60 * progress + gaussian(random) * 8;
    const spread = 150 - 60 * progress;
    const weekday = (((TODAY_WEEKDAY - 1 + day - last) % 7) + 7) % 7;
    const intake = 2280 + gaussian(random) * 110 + (weekday === 6 ? 330 : 0);
    return { day, tdee, low: tdee - spread, high: tdee + spread, intake };
  });
})();

export const programTargets = {
  next: {
    from: "12 Oct",
    calories: 2250,
    change: "−50",
    protein: 160,
    carbs: 235,
    fat: 75,
    expenditure: "2,720",
    uncertainty: "90",
  },
  current: {
    since: "5 Oct",
    calories: 2300,
    change: "−100",
    protein: demoTargets.protein,
    carbs: demoTargets.carbs,
    fat: demoTargets.fat,
    expenditure: "2,700",
    uncertainty: "110",
  },
  days: [
    { day: "Mon", calories: 2300, protein: 160, carbs: 245, fat: 76 },
    { day: "Tue", calories: 2300, protein: 160, carbs: 245, fat: 76 },
    { day: "Wed", calories: 2300, protein: 160, carbs: 245, fat: 76 },
    { day: "Thu", calories: 2300, protein: 160, carbs: 245, fat: 76 },
    { day: "Fri", calories: 2300, protein: 160, carbs: 245, fat: 76 },
    { day: "Sat", calories: 2600, protein: 160, carbs: 300, fat: 84 },
    { day: "Sun", calories: 2300, protein: 160, carbs: 245, fat: 76 },
  ],
};

export function formatNumber(value: number) {
  return Math.round(value).toLocaleString("en-GB");
}
