import { MoveLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "404 - Page Not Found",
  description:
    "The page you're looking for doesn't exist. Return to the homepage to explore my portfolio and projects.",
  openGraph: {
    title: "404 - Page Not Found | Deniz Lopes Güneş",
    description: "The page you're looking for doesn't exist.",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function NotFound() {
  return (
    <main className="grow">
      <article className="mt-8 flex flex-col gap-8 pb-16">
        <div className="min-h-full px-4 sm:px-6 sm:py-24 md:grid md:place-items-center lg:px-8">
          <div className="mx-auto max-w-2xl">
            <section className="sm:flex">
              <p className="text-6xl font-bold font-calistoga text-muted-foreground">
                404
              </p>
              <div className="sm:ml-6">
                <div className="sm:border-l sm:border-gray-200 sm:pl-6">
                  <h1 className="title sm:text-5xl">
                    cannot find <i>{"{path}"}</i>...
                  </h1>
                  <p className="mt-1 text-base text-muted-foreground">
                    It works on my machine though... I either deleted it or you
                    typed it wrong. Let's pretend this didn't happen.
                  </p>
                </div>
                <div className="mt-10 flex space-x-3 sm:border-l sm:border-transparent sm:pl-6">
                  <Link
                    className="inline-flex items-center gap-2 justify-start hover:text-accent transition-colors"
                    href="/"
                  >
                    <MoveLeft />
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
