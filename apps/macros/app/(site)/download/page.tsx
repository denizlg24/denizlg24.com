import { Faq, Platforms } from "@/app/_landing/sections/get-macros";
import { PageIntro } from "@/app/_landing/sections/page-intro";
import { pageMetadata } from "@/app/metadata";

export const metadata = pageMetadata(
  "Get Macros",
  "Get Macros on the App Store for iPhone, or install it on Android.",
  "/download",
);

export default function DownloadPage() {
  return (
    <>
      <PageIntro
        eyebrow="Get Macros"
        title={
          <>
            <span className="block">On iPhone and Android.</span>
            <span className="block text-muted-foreground">
              Free, with no ads.
            </span>
          </>
        }
        lead={
          <p>
            iPhone gets it from the App Store; Android phones install it from
            this page.
          </p>
        }
      />
      <Platforms />
      <Faq />
    </>
  );
}
