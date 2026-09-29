import Link from "next/link";
import { AppIcon, primaryButton } from "@/app/_landing/site";
import { pageMetadata } from "@/app/metadata";
import { getPublicAppUrl } from "@/lib/email";

export const metadata = {
  ...pageMetadata("Install Macros", "Install Macros on your iPhone."),
  robots: { index: false, follow: false },
};

export default function InstallPage() {
  const manifestUrl = getPublicAppUrl("/ios/adhoc/manifest.plist");
  const installUrl = `itms-services://?action=download-manifest&url=${encodeURIComponent(manifestUrl)}`;

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
        <div className="space-y-6 pt-2">
          <div>
            <h1 className="text-2xl font-semibold leading-tight tracking-tight">
              Install Macros
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Open this page in Safari on your iPhone. It only installs on
              iPhones registered for early access.
            </p>
          </div>
          <a href={installUrl} className={`${primaryButton} w-full`}>
            Install
          </a>
        </div>
      </main>
    </div>
  );
}
