"use client";

import { MoveLeft, RefreshCcw } from "lucide-react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string; statusCode?: number };
  reset: () => void;
}) {
  const isForbidden =
    error.name === "ForbiddenError" || (error as any).statusCode === 403;

  return (
    <main className="grow">
      <article className="mt-8 flex flex-col gap-8 pb-16">
        <div className="min-h-full px-4 sm:px-6 sm:py-24 md:grid md:place-items-center lg:px-8">
          <div className="mx-auto max-w-2xl">
            <section className="sm:flex">
              <p className="text-6xl font-bold font-calistoga text-muted-foreground">
                {isForbidden ? "403" : "500"}
              </p>
              <div className="sm:ml-6">
                <div className="sm:border-l sm:border-gray-200 sm:pl-6">
                  <h1 className="title sm:text-5xl">
                    {isForbidden ? (
                      <>
                        hold on a <i>second</i>...
                      </>
                    ) : (
                      <>
                        something <i>broke</i>...
                      </>
                    )}
                  </h1>
                  <p className="mt-1 text-base text-muted-foreground">
                    {isForbidden
                      ? "Why are you trying to do something you shouldn't? That's not very nice. Go back home and think about what you've done."
                      : "Code looked fine when I pushed it. Maybe a cosmic ray hit the server?"}
                  </p>
                </div>
                <div className="mt-10 flex space-x-3 sm:border-l sm:border-transparent sm:pl-6">
                  <Link
                    className="inline-flex items-center gap-2 justify-start hover:text-accent transition-colors"
                    href="/"
                  >
                    <MoveLeft className="w-4 h-4" />
                    back to home
                  </Link>
                  <button
                    onClick={reset}
                    className="inline-flex items-center gap-2 justify-start hover:text-accent transition-colors ml-4"
                  >
                    <RefreshCcw className="w-4 h-4" />
                    try again
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </article>
    </main>
  );
}
