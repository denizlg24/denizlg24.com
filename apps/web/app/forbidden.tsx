import { MoveLeft } from "lucide-react";
import Link from "next/link";

export default function Forbidden() {
  return (
    <main className="grow">
      <article className="mt-8 flex flex-col gap-8 pb-16">
        <div className="min-h-full px-4 sm:px-6 sm:py-24 md:grid md:place-items-center lg:px-8">
          <div className="mx-auto max-w-2xl">
            <section className="sm:flex">
              <p className="text-6xl font-bold font-calistoga text-muted-foreground">
                403
              </p>
              <div className="sm:ml-6">
                <div className="sm:border-l sm:border-gray-200 sm:pl-6">
                  <h1 className="title sm:text-5xl">
                    hold on a <i>second</i>...
                  </h1>
                  <p className="mt-1 text-base text-muted-foreground">
                    Why are you trying to do something you shouldn't? That's not
                    very nice. Go back home and think about what you've done.
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
                </div>
              </div>
            </section>
          </div>
        </div>
      </article>
    </main>
  );
}
