import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="max-w-md space-y-6 text-center">
        <h1 className="font-display text-6xl">
          This reel seems to be missing.
        </h1>
        <p className="text-muted">The page you were looking for isn't here.</p>
        <Link
          href="/"
          data-nav
          data-nav-autofocus
          className="inline-block rounded-full bg-paper px-7 py-3 text-ink"
        >
          Back to Stream
        </Link>
      </div>
    </main>
  );
}
