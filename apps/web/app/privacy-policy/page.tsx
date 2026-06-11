export const revalidate = 15552000; // Revalidate every 6 months

import type { Metadata } from "next";
import { StyledLink } from "@/components/styled-link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Learn how we handle your information on this portfolio website.",
  openGraph: {
    title: "Privacy Policy | Deniz Lopes Güneş",
    description:
      "Learn how we handle your information on this portfolio website.",
    url: "https://denizlg24.com/privacy-policy",
    type: "website",
    locale: "en_US",
    siteName: "Deniz Lopes Güneş Portfolio",
  },
  twitter: {
    card: "summary_large_image",
    title: "Privacy Policy | Deniz Lopes Güneş",
    description:
      "Learn how we handle your information on this portfolio website.",
  },
};

export default function PrivacyPolicyPage() {
  return (
    <main className="max-w-4xl mx-auto px-4">
      <h1 className="text-4xl font-bold mb-2 font-calistoga text-center">
        privacy policy.
      </h1>
      <article className="max-w-none mt-16">
        <p className="text-muted-foreground mb-8">
          Last Updated: December 2025
        </p>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">Hey, Welcome!</h2>
          <p className="text-foreground/80 leading-relaxed">
            Thanks for stopping by! This Privacy Policy is just here to let you
            know how things work around here. My website is mainly about
            showcasing my work, and I'm all about respecting your privacy.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">
            What Information I Collect (Hint: Not Much)
          </h2>
          <p className="text-foreground/80 leading-relaxed mb-4">
            Honestly, this is just a portfolio site, so I don't actively collect
            any personal information. There's no account creation, no tracking
            cookies, and definitely no sneaky data gathering.
          </p>

          <h3 className="text-xl font-medium mb-3 mt-6">Contact Info</h3>
          <p className="text-foreground/80 leading-relaxed">
            If you reach out via email or the contact form, the info you provide
            is entirely up to you. I'll only use it to reply and have a
            conversation with you—no funny business. When you submit the contact
            form, I collect:
          </p>
          <ul className="list-disc list-inside space-y-2 text-foreground/80 ml-4 mt-3">
            <li>Your name</li>
            <li>Your email address</li>
            <li>Your message</li>
            <li>A timestamp and ticket ID for reference</li>
          </ul>
          <p className="text-foreground/80 leading-relaxed mt-3">
            That's it. Nothing more, nothing less.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">How I Use the Info</h2>
          <p className="text-foreground/80 leading-relaxed mb-3">
            Here's what I might do with any information I collect:
          </p>
          <ul className="list-disc list-inside space-y-2 text-foreground/80 ml-4">
            <li>Make sure the site is running smoothly</li>
            <li>Improve the website based on feedback you might share</li>
            <li>Respond to your questions or feedback</li>
            <li>Send you a confirmation email when you reach out</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">
            Sharing Your Info (Spoiler: I Don't)
          </h2>
          <p className="text-foreground/80 leading-relaxed">
            I don't sell, trade, or rent your personal info. If you shared
            something sensitive by accident, feel free to reach out, and I'll
            help you remove it.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">
            Security (The Internet Isn't Perfect)
          </h2>
          <p className="text-foreground/80 leading-relaxed">
            I'll do my best to keep any info you share safe, but let's be
            real—no system is foolproof. While I'll take reasonable steps to
            protect your info, I can't promise 100% security.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">
            Policy Updates (No Surprises)
          </h2>
          <p className="text-foreground/80 leading-relaxed">
            This policy is current as of December 2025. If I make any changes,
            I'll update it here, so you're always in the loop. Feel free to
            check back occasionally, but don't worry—I'm not making any big
            changes without letting you know.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">Got Questions?</h2>
          <p className="text-foreground/80 leading-relaxed">
            If you have any questions, concerns, or just want to say hi, drop me
            an email at{" "}
            <StyledLink href="mailto:denizlg24@gmail.com">
              denizlg24@gmail.com
            </StyledLink>{" "}
            or use the <StyledLink href="/contact">contact form</StyledLink>.
            I'd love to hear from you!
          </p>
        </section>
      </article>
    </main>
  );
}
