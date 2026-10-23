import { LoaderCircle, Play, RotateCcw, RotateCw } from "lucide-react";
import { cx, focusRing } from "./styles";

export function Backdrop({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      aria-hidden="true"
      draggable={false}
      className="absolute inset-0 size-full object-cover opacity-50"
    />
  );
}

export function Spinner() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
    >
      <LoaderCircle className="size-14 animate-spin text-white/90 lg:size-20" />
    </div>
  );
}

export function PausedMark() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
    >
      <Play className="size-16 fill-white/90 text-white/90 drop-shadow-lg lg:size-24" />
    </div>
  );
}

export function Notice({
  title,
  action,
}: {
  title: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      role="status"
      className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-6 px-8 text-center"
    >
      <p className="max-w-xl text-balance font-medium text-white/90 text-xl drop-shadow-md sm:text-2xl lg:text-4xl">
        {title}
      </p>
      {action && (
        <button
          type="button"
          data-player-nav=""
          data-player-role="control"
          onClick={action.onClick}
          className={cx(
            "pointer-events-auto rounded-full bg-white px-6 py-2.5 font-medium text-base text-black hover:bg-white/90 lg:px-8 lg:py-3.5 lg:text-xl",
            focusRing,
          )}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

export function CaptionText({
  text,
  raised,
}: {
  text: string;
  raised: boolean;
}) {
  if (!text) return null;
  return (
    <div
      aria-live="off"
      className={cx(
        "pointer-events-none absolute inset-x-0 z-10 flex justify-center px-6 transition-[bottom] duration-300",
        raised
          ? "bottom-32 sm:bottom-36 lg:bottom-48"
          : "bottom-10 lg:bottom-16",
      )}
    >
      <p className="max-w-4xl whitespace-pre-line text-center text-white text-xl leading-snug sm:text-2xl lg:text-4xl">
        <span className="box-decoration-clone rounded bg-black/70 px-2 py-0.5">
          {text}
        </span>
      </p>
    </div>
  );
}

export function SeekFlash({ side }: { side: "back" | "forward" }) {
  const Icon = side === "back" ? RotateCcw : RotateCw;
  return (
    <div
      aria-hidden="true"
      className={cx(
        "pointer-events-none absolute inset-y-0 z-10 flex w-1/3 flex-col items-center justify-center gap-2 bg-white/5",
        side === "back" ? "left-0 rounded-r-full" : "right-0 rounded-l-full",
      )}
    >
      <Icon className="size-10" />
      <span className="font-medium text-sm tabular-nums">
        {side === "back" ? "−10 s" : "+10 s"}
      </span>
    </div>
  );
}
