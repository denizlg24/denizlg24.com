import {
  addDays,
  format,
  isSameDay,
  isToday,
  isYesterday,
  parseISO,
  startOfWeek,
} from "date-fns"

export function todayIso(): string {
  return format(new Date(), "yyyy-MM-dd")
}

export function isoToDate(iso: string): Date {
  return parseISO(`${iso}T00:00:00`)
}

export function dateToIso(date: Date): string {
  return format(date, "yyyy-MM-dd")
}

export function relativeDayLabel(iso: string): string {
  const d = isoToDate(iso)
  if (isToday(d)) return "Today"
  if (isYesterday(d)) return "Yesterday"
  return format(d, "EEE, MMM d")
}

export function shiftIso(iso: string, days: number): string {
  return dateToIso(addDays(isoToDate(iso), days))
}

export function weekDaysFor(iso: string): {
  iso: string
  letter: string
  num: number
  isSelected: boolean
  isFuture: boolean
}[] {
  const selected = isoToDate(iso)
  const start = startOfWeek(selected, { weekStartsOn: 1 })
  const today = new Date()
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(start, i)
    return {
      iso: dateToIso(d),
      letter: format(d, "EEEEE"),
      num: Number(format(d, "d")),
      isSelected: isSameDay(d, selected),
      isFuture: d > today && !isSameDay(d, today),
    }
  })
}
