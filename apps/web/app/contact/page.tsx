export const revalidate = 15552000; // Revalidate every 6 months

import { Mail, MapPin, Phone } from "lucide-react";
import type { Metadata } from "next";
import { ContactForm } from "./components/contact-form";

export const metadata: Metadata = {
  title: {
    absolute: "Contact | Deniz Lopes Güneş",
  },
  description:
    "Get in touch with Deniz Lopes Güneş for collaborations, consulting, speaking, or general inquiries.",
  openGraph: {
    title: "Contact | Deniz Lopes Güneş",
    description:
      "Get in touch with Deniz Lopes Güneş for collaborations, consulting, speaking, or general inquiries.",
    url: "https://denizlg24.com/contact",
    siteName: "Deniz Lopes Güneş",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Contact | Deniz Lopes Güneş",
    description:
      "Get in touch with Deniz Lopes Güneş for collaborations, consulting, speaking, or general inquiries.",
  },
};

export default async function Page() {
  return (
    <main className="flex flex-col items-center">
      <section className="w-full max-w-5xl mx-auto px-4 text-center items-center">
        <h1 className="sm:text-5xl text-4xl text-balance font-calistoga text-center">
          contact me.
        </h1>

        <ContactForm />

        <div className="flex flex-col items-center gap-6 mt-12">
          <div className="flex sm:flex-row flex-col flex-wrap items-center text-center justify-center gap-x-8 gap-y-4 text-sm w-full">
            <div className="flex flex-col items-center gap-1 flex-1">
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                Email
              </span>
              <a
                href="mailto:denizgunes@oceaninformatix.com"
                className="inline-flex items-center gap-2 text-accent hover:text-foreground transition-colors"
                target="_blank"
                rel="noopener"
              >
                <Mail className="w-4 h-4" />
                denizgunes@oceaninformatix.com
              </a>
            </div>
            <div className="flex flex-col items-center gap-1 flex-1">
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                Phone
              </span>
              <a
                href="tel:+351910143859"
                className="inline-flex items-center gap-2 text-accent hover:text-foreground transition-colors"
                target="_blank"
                rel="noopener"
              >
                <Phone className="w-4 h-4" />
                +351 910 143 859
              </a>
            </div>
            <div className="flex flex-col items-center gap-1 flex-1">
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                Location
              </span>
              <a
                href="https://maps.app.goo.gl/FSaCHY8Kub2kamaVA"
                className="inline-flex items-center gap-2 text-accent hover:text-foreground transition-colors"
                target="_blank"
                rel="noopener"
              >
                <MapPin className="w-4 h-4" />
                Porto, Portugal
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
