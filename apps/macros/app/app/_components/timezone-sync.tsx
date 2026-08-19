"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { queryKeys } from "@/lib/app-cache/query-keys"

type TimezoneSyncProps = {
  initialTimezone: string
}

function getBrowserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function TimezoneSync({ initialTimezone }: TimezoneSyncProps) {
  const queryClient = useQueryClient()

  useEffect(() => {
    const timezone = getBrowserTimezone()

    if (!timezone || timezone === initialTimezone) {
      return
    }

    const controller = new AbortController()

    async function syncTimezone() {
      const response = await fetch("/api/profile/timezone", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone }),
        signal: controller.signal,
      })

      if (response.ok) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
        void queryClient.invalidateQueries({
          queryKey: queryKeys.calorieSummary,
        })
        void queryClient.invalidateQueries({
          queryKey: queryKeys.foodHistory(20),
        })
      }
    }

    syncTimezone().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") {
        return
      }

      console.error("Failed to sync timezone", error)
    })

    return () => controller.abort()
  }, [initialTimezone, queryClient])

  return null
}
