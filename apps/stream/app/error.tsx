"use client";

export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="max-w-md space-y-6 text-center">
        <h1 className="font-display text-5xl">Something went wrong.</h1>
        <p className="text-muted">
          It's not you — Stream had a hiccup. Please try again in a moment.
        </p>
        <button
          type="button"
          onClick={reset}
          data-nav
          data-nav-autofocus
          className="rounded-full bg-paper px-7 py-3 text-ink"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
