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

export interface DemoIngredient {
  id: string;
  name: string;
  grams: number;
  /** Calories and macros per 100 g. */
  per100: MacroAmounts & { calories: number };
}

export const recipeServings = 4;

export const recipeIngredients: DemoIngredient[] = [
  {
    id: "turkey",
    name: "Turkey mince, 5% fat",
    grams: 560,
    per100: { calories: 130, protein: 21, carbs: 0, fat: 5 },
  },
  {
    id: "beans",
    name: "Kidney beans, drained",
    grams: 480,
    per100: { calories: 105, protein: 7, carbs: 14, fat: 0.5 },
  },
  {
    id: "tomatoes",
    name: "Chopped tomatoes",
    grams: 800,
    per100: { calories: 21, protein: 1, carbs: 3.5, fat: 0.1 },
  },
  {
    id: "sweetcorn",
    name: "Sweetcorn",
    grams: 210,
    per100: { calories: 80, protein: 2.6, carbs: 16, fat: 1.2 },
  },
  {
    id: "onion",
    name: "Onion and peppers",
    grams: 250,
    per100: { calories: 40, protein: 1.1, carbs: 9, fat: 0.1 },
  },
  {
    id: "oil",
    name: "Olive oil",
    grams: 30,
    per100: { calories: 884, protein: 0, carbs: 0, fat: 100 },
  },
];

export function ingredientAmounts(ingredient: DemoIngredient) {
  const scale = ingredient.grams / 100;
  return {
    calories: ingredient.per100.calories * scale,
    protein: ingredient.per100.protein * scale,
    carbs: ingredient.per100.carbs * scale,
    fat: ingredient.per100.fat * scale,
  };
}

const recipeTotals = recipeIngredients.reduce(
  (total, ingredient) => {
    const amounts = ingredientAmounts(ingredient);
    return {
      calories: total.calories + amounts.calories,
      protein: total.protein + amounts.protein,
      carbs: total.carbs + amounts.carbs,
      fat: total.fat + amounts.fat,
    };
  },
  { calories: 0, protein: 0, carbs: 0, fat: 0 },
);

export const recipeWeightGrams = recipeIngredients.reduce(
  (total, ingredient) => total + ingredient.grams,
  0,
);

export const recipe: DemoFood = {
  id: "turkey-chilli",
  name: "Turkey chilli",
  amount: "1 serving",
  iconKey: null,
  calories: Math.round(recipeTotals.calories / recipeServings),
  protein: Math.round(recipeTotals.protein / recipeServings),
  carbs: Math.round(recipeTotals.carbs / recipeServings),
  fat: Math.round(recipeTotals.fat / recipeServings),
};

export const recipeTotalCalories = recipeTotals.calories;

/** A packet of oats: what the label photo reads, per 100 g. */
export const labelScan = {
  barcode: "5012345678900",
  product: "Rolled oats",
  per: "per 100 g",
  rows: [
    { label: "Energy", value: "1,609 kJ / 382 kcal", macro: "calories" },
    { label: "Fat", value: "8.0 g", macro: "fat" },
    { label: "of which saturates", value: "1.4 g", sub: true },
    { label: "Carbohydrate", value: "60 g", macro: "carbs" },
    { label: "of which sugars", value: "1.1 g", sub: true },
    { label: "Fibre", value: "9.0 g" },
    { label: "Protein", value: "13 g", macro: "protein" },
    { label: "Salt", value: "0.01 g" },
  ],
  read: { calories: 382, protein: 13, carbs: 60, fat: 8 },
} as const;

export interface DemoNutrient {
  label: string;
  consumed: number;
  reference: number;
  unit: string;
  kind: "target" | "limit";
  /** The macro hue the app draws this nutrient's group in, if any. */
  macro?: "protein" | "carbs" | "fat";
}

/** A day's nutrients against reference intakes for a 34-year-old man. */
export const demoNutrients: ReadonlyArray<DemoNutrient> = [
  {
    label: "Fiber",
    consumed: 27,
    reference: 32,
    unit: "g",
    kind: "target",
    macro: "carbs",
  },
  {
    label: "Omega-3",
    consumed: 1.2,
    reference: 1.6,
    unit: "g",
    kind: "target",
    macro: "fat",
  },
  {
    label: "Saturated fat",
    consumed: 19,
    reference: 26,
    unit: "g",
    kind: "limit",
    macro: "fat",
  },
  {
    label: "Vitamin C",
    consumed: 112,
    reference: 90,
    unit: "mg",
    kind: "target",
  },
  {
    label: "Vitamin D",
    consumed: 4.1,
    reference: 15,
    unit: "µg",
    kind: "target",
  },
  { label: "Iron", consumed: 13.2, reference: 8, unit: "mg", kind: "target" },
  {
    label: "Potassium",
    consumed: 2940,
    reference: 3400,
    unit: "mg",
    kind: "target",
  },
  {
    label: "Sodium",
    consumed: 2520,
    reference: 2300,
    unit: "mg",
    kind: "limit",
  },
];

export const expenditureStats = {
  estimate: "2,720",
  range: "2,610–2,830",
  change: "+60",
  formula: "2,570",
  versusFormula: "+6%",
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
