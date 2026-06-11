import { create } from "zustand";

export type BackgroundTask = {
  id: string;
  label: string;
  statusText: string;
  color: string;
  href?: string;
  active: boolean;
};

type BackgroundTasksState = {
  tasks: Record<string, BackgroundTask>;
  register: (task: BackgroundTask) => void;
  unregister: (id: string) => void;
  update: (id: string, partial: Partial<Omit<BackgroundTask, "id">>) => void;
};

export const useBackgroundTasksStore = create<BackgroundTasksState>((set) => ({
  tasks: {},
  register: (task) =>
    set((state) => ({ tasks: { ...state.tasks, [task.id]: task } })),
  unregister: (id) =>
    set((state) => {
      const { [id]: _, ...rest } = state.tasks;
      return { tasks: rest };
    }),
  update: (id, partial) =>
    set((state) => {
      const existing = state.tasks[id];
      if (!existing) return state;
      return { tasks: { ...state.tasks, [id]: { ...existing, ...partial } } };
    }),
}));
