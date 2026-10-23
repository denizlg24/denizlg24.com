"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { setTvMode } from "@/app/actions";

export function TvToggle({ tv }: { tv: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const set = (on: boolean) =>
    startTransition(async () => {
      await setTvMode(on);
      router.refresh();
    });
  return (
    <div className="space-y-3">
      <p className="text-muted">
        TV mode makes everything larger and lets you move around with a remote's
        arrow buttons. It switches on by itself on most smart TVs.
      </p>
      <div className="flex gap-2">
        {[
          { on: false, label: "Normal" },
          { on: true, label: "TV mode" },
        ].map((option) => (
          <button
            key={option.label}
            type="button"
            data-nav
            disabled={pending}
            aria-pressed={tv === option.on}
            onClick={() => set(option.on)}
            className={`rounded-full px-5 py-2.5 transition-colors ${tv === option.on ? "bg-paper text-ink" : "text-muted ring-1 ring-hairline hover:text-paper"}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
