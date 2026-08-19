import { z } from "zod";

export const macrosIsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 0);
    return (
      date.getFullYear() === year &&
      date.getMonth() === (month ?? 1) - 1 &&
      date.getDate() === day
    );
  }, "Invalid calendar date");

export const macrosMealTypeSchema = z.enum([
  "breakfast",
  "lunch",
  "dinner",
  "snack",
]);
