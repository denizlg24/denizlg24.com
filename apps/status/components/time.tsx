"use client";
import { useEffect, useState } from "react";

export function useLocalZone() {
  const [local, setLocal] = useState(false);
  useEffect(() => setLocal(true), []);
  return local ? undefined : "UTC";
}
export function format(
  value: string | number,
  short: boolean,
  timeZone: string | undefined,
) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    ...(short ? {} : { hour: "2-digit", minute: "2-digit" }),
  }).format(typeof value === "string" ? new Date(value) : value);
}
export function Time({
  value,
  short = false,
  prefix,
  fallback = "—",
}: {
  value: string | null;
  short?: boolean;
  prefix?: string;
  fallback?: string;
}) {
  const timeZone = useLocalZone();
  if (!value) return <>{fallback}</>;
  return (
    <time dateTime={value}>
      {prefix ? `${prefix} ` : ""}
      {format(value, short, timeZone)}
    </time>
  );
}
