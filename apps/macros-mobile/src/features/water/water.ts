/** A volume system: what one glass holds, its steps, and what a cup is. */
export interface WaterUnits {
  unit: "ml" | "oz";
  label: string;
  /** What a full glass holds, in `unit`. */
  capacity: number;
  /** The smallest amount the glass snaps to, in `unit`. */
  step: number;
  /** One cup in `unit`: a metric cup, or a US customary one. */
  cup: number;
  presets: readonly number[];
  initial: number;
}

export const METRIC_WATER: WaterUnits = {
  unit: "ml",
  label: "ml",
  capacity: 1000,
  step: 50,
  cup: 250,
  presets: [250, 330, 500, 750],
  initial: 250,
};

export const IMPERIAL_WATER: WaterUnits = {
  unit: "oz",
  label: "fl oz",
  capacity: 32,
  step: 2,
  cup: 8,
  presets: [8, 12, 16, 24],
  initial: 8,
};

/** The amount a point on the glass means, `fraction` 0 at the bottom. */
export function amountAt(fraction: number, units: WaterUnits): number {
  const clamped = Math.min(Math.max(fraction, 0), 1);
  const stepped = Math.round((clamped * units.capacity) / units.step);
  return Math.max(stepped * units.step, units.step);
}

const QUARTERS = ["", "¼", "½", "¾"] as const;

/** Cups to the nearest quarter: "1½ cups", "¾ cup", "4 cups". */
export function formatCups(amount: number, units: WaterUnits): string {
  const quarters = Math.round((amount / units.cup) * 4);
  if (quarters === 0) return "less than ¼ cup";
  const whole = Math.floor(quarters / 4);
  const part = QUARTERS[quarters % 4];
  const figure = whole === 0 ? part : `${whole}${part}`;
  return `${figure} ${quarters > 4 ? "cups" : "cup"}`;
}

/** How full each cup is, for drawing the amount as a row of cups. */
export function cupFills(amount: number, units: WaterUnits): number[] {
  const cups = amount / units.cup;
  const count = Math.ceil(cups - 1e-9);
  return Array.from({ length: count }, (_, index) =>
    Math.min(Math.max(cups - index, 0), 1),
  );
}
