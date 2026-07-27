"use client";

import Image from "next/image";

interface Step {
  number: number;
  title: string;
  description: string;
  command?: string;
  gif: string;
}

const steps: Step[] = [
  {
    number: 1,
    title: "Initialize your project",
    description:
      "Run envy init in your project directory. This creates a secure project ID and sets up local encryption. You'll be prompted for a passphrase that encrypts your environment files locally — the server never sees it.",
    command: "envy init",
    gif: "/demos/init_demo.gif",
  },
  {
    number: 2,
    title: "Stage and commit your .env",
    description:
      "Stage your .env with envy add, inspect its redacted diff, then commit. Envoy derives an independent encryption key for each file from your one project passphrase.",
    command: "envy add .env && envy diff --cached && envy commit -m \"Initial secrets\"",
    gif: "/demos/encrypt_demo.gif",
  },
  {
    number: 3,
    title: "Pull on any machine",
    description:
      "Clone your repo on another machine and run envy pull. One project passphrase restores every managed file the member can download; owners can grant access per file, and plaintext never touches the wire.",
    command: "envy pull",
    gif: "/demos/pull_demo.gif",
  },
];

export function GettingStartedSection() {
  return (
    <section className="w-full max-w-5xl mx-auto px-4 py-20">
      <div className="text-center mb-16">
        <h2 className="font-mono text-sm font-medium text-primary tracking-wider uppercase mb-4">
          Getting Started
        </h2>
        <p className="text-2xl md:text-3xl font-semibold text-foreground max-w-2xl mx-auto">
          Three commands to secure your environment variables
        </p>
      </div>

      <div className="space-y-24">
        {steps.map((step, index) => (
          <div
            key={step.number}
            className={`flex flex-col gap-8 ${
              index % 2 === 1 ? "md:flex-row-reverse" : "md:flex-row"
            } items-center`}
          >
            {/* Text content */}
            <div className="flex-1 space-y-4">
              <div className="flex items-center gap-3">
                <span className="font-mono text-4xl font-bold text-primary/30">
                  {step.number.toString().padStart(2, "0")}
                </span>
                <h3 className="text-xl font-semibold text-foreground">
                  {step.title}
                </h3>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                {step.description}
              </p>
              {step.command && (
                <code className="inline-block font-mono text-sm text-primary bg-primary/10 px-3 py-1.5 rounded-md">
                  $ {step.command}
                </code>
              )}
            </div>

            {/* GIF */}
            <div className="flex-1 w-full">
              <div className="relative rounded-lg overflow-hidden border border-border/50 bg-black/50 backdrop-blur-sm">
                <Image
                  src={step.gif}
                  alt={`Demo: ${step.title}`}
                  width={800}
                  height={500}
                  className="w-full h-auto"
                  unoptimized
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Additional info */}
      <div className="mt-24 text-center">
        <div className="inline-flex flex-col sm:flex-row gap-6 sm:gap-12 text-sm text-muted-foreground">
          <div className="flex items-center justify-center gap-2">
            <svg
              className="w-5 h-5 text-primary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
            <span>Zero-knowledge encryption</span>
          </div>
          <div className="flex items-center justify-center gap-2">
            <svg
              className="w-5 h-5 text-primary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            <span>Team collaboration</span>
          </div>
          <div className="flex items-center justify-center gap-2">
            <svg
              className="w-5 h-5 text-primary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
            <span>Git-like versioning</span>
          </div>
        </div>
      </div>
    </section>
  );
}
