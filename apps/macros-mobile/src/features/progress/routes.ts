import { formModal, type ModalRoute } from "@/features/shell/routes";

export const progressModalRoutes: ModalRoute[] = [
  { name: "nutrition-program", options: { ...formModal, title: "Program" } },
  { name: "weight-goal", options: { ...formModal, title: "Goal" } },
];

export const progressPaths = {
  strategy: "/progress/strategy",
  goals: "/progress/goals",
  statistics: "/progress/statistics",
  program: "/nutrition-program",
  goal: "/weight-goal",
  weighIn: "/weigh-in",
} as const;
