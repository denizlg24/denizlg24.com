"use client";

import { format } from "date-fns";

export const TodaysDate = ({ formatter }: { formatter: string }) => {
  const today = new Date();
  return format(today, formatter);
};
