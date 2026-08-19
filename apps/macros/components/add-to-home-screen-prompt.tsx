"use client"

import { Download, Share, X } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"

const DISMISS_KEY = "macros:add-to-home-screen-dismissed"

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{
    outcome: "accepted" | "dismissed"
    platform: string
  }>
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean
}

function isBeforeInstallPromptEvent(
  event: Event
): event is BeforeInstallPromptEvent {
  return (
    "prompt" in event &&
    typeof event.prompt === "function" &&
    "userChoice" in event
  )
}

function isStandalone() {
  const navigatorWithStandalone: NavigatorWithStandalone = navigator

  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    navigatorWithStandalone.standalone === true
  )
}

function isMobileBrowser() {
  const userAgent = navigator.userAgent.toLowerCase()
  const mobileUserAgent = /android|iphone|ipad|ipod/.test(userAgent)
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches

  return mobileUserAgent || coarsePointer
}

function isIos() {
  return /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase())
}

export function AddToHomeScreenPrompt() {
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)
  const [showIosHelp, setShowIosHelp] = useState(false)

  useEffect(() => {
    if (
      localStorage.getItem(DISMISS_KEY) === "true" ||
      !isMobileBrowser() ||
      isStandalone()
    ) {
      return
    }

    if (isIos()) {
      setShowIosHelp(true)
      setVisible(true)
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      if (!isBeforeInstallPromptEvent(event)) return

      event.preventDefault()
      setInstallPrompt(event)
      setShowIosHelp(false)
      setVisible(true)
    }

    const handleAppInstalled = () => {
      setVisible(false)
      localStorage.setItem(DISMISS_KEY, "true")
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt)
    window.addEventListener("appinstalled", handleAppInstalled)

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt
      )
      window.removeEventListener("appinstalled", handleAppInstalled)
    }
  }, [])

  if (!visible) return null

  const dismiss = () => {
    setVisible(false)
    localStorage.setItem(DISMISS_KEY, "true")
  }

  const install = async () => {
    if (!installPrompt) return

    await installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null)
    dismiss()
  }

  return (
    <div className="macros-fixed-inset-x fixed bottom-4 z-50 px-4">
      <div className="rounded-lg border bg-popover p-4 text-popover-foreground shadow-xl">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Download className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              Add Macros to your home screen
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {showIosHelp
                ? "Open the browser share menu, then choose Add to Home Screen."
                : "Install it for a cleaner mobile app experience."}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss home screen prompt"
            onClick={dismiss}
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          {showIosHelp ? (
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Share className="size-4" />
              <span>Share, then Add to Home Screen</span>
            </div>
          ) : (
            <Button type="button" size="sm" onClick={install}>
              <Download className="size-4" />
              Install
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
