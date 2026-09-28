import { compactSheet, type ModalRoute } from "@/features/shell/routes";

export const todayModalRoutes: ModalRoute[] = [
  { name: "quick-add", options: compactSheet },
  { name: "weigh-in", options: compactSheet },
];
