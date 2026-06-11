"use client";

import { useRouter } from "next/navigation";
import { useBackgroundTasksStore } from "@/stores/background-tasks";

export function BackgroundTasksIndicator() {
  const tasks = useBackgroundTasksStore((s) => s.tasks);
  const router = useRouter();
  const activeTasks = Object.values(tasks);

  if (activeTasks.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5">
      {activeTasks.map((task) => (
        <button
          key={task.id}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (task.href) router.push(task.href);
          }}
          className="flex items-center gap-1.5 rounded-full bg-secondary/60 px-2 py-0.5 text-[10px] font-medium text-foreground/80 hover:bg-secondary transition-colors"
        >
          <span
            className={`size-1.5 rounded-full ${task.color} ${task.active ? "animate-pulse" : ""}`}
          />
          <span className="tabular-nums">{task.statusText}</span>
        </button>
      ))}
    </div>
  );
}
