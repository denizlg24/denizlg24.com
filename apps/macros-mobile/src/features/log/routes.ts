import {
  compactSheet,
  detentSheet,
  type ModalRoute,
} from "@/features/shell/routes";

export const logModalRoutes: ModalRoute[] = [
  { name: "entry/[id]", options: detentSheet },
  { name: "log-copy", options: detentSheet },
  { name: "log-move", options: compactSheet },
  { name: "day-note", options: detentSheet },
];
