import { addDays, format, parseISO, startOfWeek, subDays } from "date-fns"

export function toIsoDate(date: Date, timezone = "UTC"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(date)
}

export function isoToUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`)
}

export function isoToLocalDate(iso: string): Date {
  return parseISO(`${iso}T00:00:00`)
}

export function dateToIso(date: Date): string {
  return format(date, "yyyy-MM-dd")
}

export function shiftIso(iso: string, days: number): string {
  return dateToIso(addDays(isoToLocalDate(iso), days))
}

export function startOfIsoWeek(iso: string): string {
  return dateToIso(startOfWeek(isoToLocalDate(iso), { weekStartsOn: 1 }))
}

export function lastNDates(today: string, days: number): string[] {
  return Array.from({ length: days }, (_, index) =>
    dateToIso(subDays(isoToLocalDate(today), days - 1 - index))
  )
}

export function measuredAtForLogDate(logDate: string): Date {
  return new Date(`${logDate}T12:00:00.000Z`)
}
