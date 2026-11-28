import { AltUnavailable } from "../types";

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await run(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

/** How many uncached documents one call may download before it returns what it has. */
export type Budget = { documents: number; deadline: number };

export const requestBudget = (): Budget => ({
  documents: 24,
  deadline: Date.now() + 20_000,
});
export const warmerBudget = (documents = 150): Budget => ({
  documents,
  deadline: Date.now() + 8 * 60_000,
});

export class BudgetSpent extends AltUnavailable {
  constructor() {
    super("Document budget for this call is spent.", 503, false);
  }
}

export function spend(budget: Budget) {
  if (budget.documents <= 0 || Date.now() > budget.deadline)
    throw new BudgetSpent();
  budget.documents--;
}
