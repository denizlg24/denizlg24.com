import {
  EarlyAccess,
  Faq,
  Platforms,
} from "@/app/_landing/sections/get-macros";
import { PageIntro } from "@/app/_landing/sections/page-intro";
import { pageMetadata } from "@/app/metadata";

export const metadata = pageMetadata(
  "Get Macros",
  "Install Macros on Android today, or request early access to the iPhone app.",
  "/download",
);

export default function DownloadPage() {
  return (
    <>
      <PageIntro
        eyebrow="Get Macros"
        title={
          <>
            <span className="block">On Android today.</span>
            <span className="block text-muted-foreground">On iPhone soon.</span>
          </>
        }
        lead={
          <p>
            Macros is free, with no ads. Android phones can install it right
            now; the iPhone app is in early access until it opens to everyone.
          </p>
        }
      />
      <Platforms />
      <EarlyAccess />
      <Faq />
    </>
  );
}
