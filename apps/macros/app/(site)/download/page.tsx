import { Faq, Platforms } from "@/app/_landing/sections/get-macros";
import { PageIntro } from "@/app/_landing/sections/page-intro";
import { pageMetadata } from "@/app/metadata";

export const metadata = pageMetadata(
  "Get Macros",
  "Install Macros on Android, or join the iPhone beta on TestFlight.",
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
            <span className="block text-muted-foreground">
              iPhone on TestFlight.
            </span>
          </>
        }
        lead={
          <p>
            Macros is free, with no ads. Android phones can install it right
            now; on iPhone, sign up below and Apple sends you a TestFlight
            invite.
          </p>
        }
      />
      <Platforms />
      <Faq />
    </>
  );
}
