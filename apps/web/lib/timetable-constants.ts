export const TIMETABLE_COLORS = [
  "background",
  "surface",
  "muted",
  "accent",
  "accent-strong",
  "foreground",
  "destructive",
] as const;

export type TimetableColor = (typeof TIMETABLE_COLORS)[number];

export interface ILeanTimetableEntry {
  _id: string;
  title: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  place?: string;
  links: {
    _id: string;
    label: string;
    url: string;
    icon?: string;
  }[];
  color: TimetableColor;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
