import Link from "next/link";
import { AppIcon } from "@/app/_landing/site";

export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="mx-auto w-full max-w-sm px-5 pt-10 pb-8">
        <Link
          href="/"
          className="-m-1 inline-flex items-center gap-2.5 rounded-lg p-1"
        >
          <AppIcon size={28} eager />
          <span className="text-[15px] font-semibold tracking-tight">
            Macros
          </span>
        </Link>
      </header>
      <main id="main" className="mx-auto w-full max-w-sm flex-1 px-5 pb-10">
        {children}
      </main>
      <footer className="mx-auto w-full max-w-sm px-5 pb-8">
        <p className="border-t pt-4 text-xs text-muted-foreground">
          <Link href="/terms" className="hover:text-foreground">
            Terms
          </Link>
          <span aria-hidden="true"> · </span>
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
        </p>
      </footer>
    </div>
  );
}
