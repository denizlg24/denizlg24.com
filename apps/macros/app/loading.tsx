"use client"

import Image from "next/image"
import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

const pieGradient =
  "conic-gradient(from 12deg, var(--color-chart-1) 0deg 108deg, var(--color-chart-2) 108deg 210deg, var(--color-chart-3) 210deg 302deg, var(--color-chart-4) 302deg 360deg)"

const LOADING_MESSAGES = [
  "Loading Macros...",
  "Organizing the good stuff...",
  "Bedazzling the numbers...",
  "Tidying your nutrition...",
  "Polishing the details...",
]

export default function Loading() {
  const [messageIndex, setMessageIndex] = useState(0)

  useEffect(() => {
    const timeout = setTimeout(() => {
      setMessageIndex(
        (currentIndex) => (currentIndex + 1) % LOADING_MESSAGES.length
      )
    }, 1400)

    return () => clearTimeout(timeout)
  }, [])

  return (
    <main className="min-h-svh bg-background text-foreground">
      <div className="mx-auto flex min-h-svh w-full max-w-sm flex-col px-5 pb-8">
        <section className="flex flex-1 flex-col items-center justify-center pb-12 text-center">
          <div className="relative flex size-40 items-center justify-center">
            <div
              aria-hidden="true"
              className="macros-loader-spin absolute inset-0 rounded-full"
              style={{ background: pieGradient }}
            />
            <div className="absolute inset-[18%] rounded-full bg-background" />
            <div className="absolute inset-[31%] flex items-center justify-center rounded-full border border-border/50 bg-background">
              <Image
                src="/logo_transparent.png"
                alt=""
                width={32}
                height={32}
                className="size-8"
              />
            </div>
            <div
              aria-hidden="true"
              className="absolute inset-0 rounded-full border border-border/50"
            />
            <div
              aria-hidden="true"
              className="absolute inset-[18%] rounded-full border border-border/40"
            />
          </div>

          <div className="mt-10 space-y-3">
            <div className="relative h-7 w-full overflow-hidden">
              {LOADING_MESSAGES.map((message, index) => (
                <p
                  key={message}
                  className={cn(
                    "absolute inset-0 text-center text-lg font-medium tracking-tight transition-all duration-500",
                    index === messageIndex
                      ? "translate-y-0 opacity-100"
                      : index < messageIndex
                        ? "-translate-y-5 opacity-0"
                        : "translate-y-5 opacity-0"
                  )}
                >
                  {message}
                </p>
              ))}
            </div>
            <p className="mx-auto max-w-64 text-sm leading-relaxed text-muted-foreground">
              Just a moment while everything gets into place.
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}
