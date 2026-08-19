"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { format } from "date-fns"
import { Trash2, X } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { queryKeys } from "@/lib/app-cache/query-keys"
import type { UpsertWeighInBody, WeighInItem } from "@/lib/weights/contracts"
import { isoToLocalDate } from "@/lib/weights/date-utils"

async function saveWeighIn(body: UpsertWeighInBody): Promise<WeighInItem> {
  const response = await fetch("/api/weight/weigh-ins", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Save failed (${response.status})`)
  const data = (await response.json()) as { entry: WeighInItem }
  return data.entry
}

async function deleteWeighIn(id: string): Promise<void> {
  const response = await fetch(`/api/weight/weigh-ins/${id}`, {
    method: "DELETE",
  })
  if (!response.ok) throw new Error(`Delete failed (${response.status})`)
}

interface WeighInDrawerFormProps {
  selectedDate: string
  activeEntry?: WeighInItem | null
  onClose: () => void
  showHandle?: boolean
}

export function WeighInDrawerForm({
  selectedDate,
  activeEntry,
  onClose,
  showHandle = true,
}: WeighInDrawerFormProps) {
  const queryClient = useQueryClient()
  const [draftWeight, setDraftWeight] = useState<string | null>(null)
  const weightValue =
    draftWeight !== null
      ? draftWeight
      : (activeEntry?.weightKg.toString() ?? "")

  async function refreshWeightData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.weightOverview }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
    ])
  }

  const saveMutation = useMutation({
    mutationFn: saveWeighIn,
    onSuccess: async () => {
      setDraftWeight(null)
      await refreshWeightData()
      onClose()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteWeighIn,
    onSuccess: async () => {
      setDraftWeight(null)
      await refreshWeightData()
      onClose()
    },
  })

  function close() {
    setDraftWeight(null)
    onClose()
  }

  function submit() {
    if (saveMutation.isPending || deleteMutation.isPending) return
    const normalized = weightValue.replace(",", ".")
    const weightKg = Number(normalized)
    if (!Number.isFinite(weightKg) || weightKg <= 0) return
    saveMutation.mutate({ logDate: selectedDate, weightKg })
  }

  return (
    <div className="p-3 pb-safe-end">
      {showHandle ? (
        <div className="mx-auto mb-3 h-1 w-14 rounded-full bg-muted-foreground/30" />
      ) : null}
      <div className="mb-4 grid grid-cols-[auto_1fr_auto] items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9"
          onClick={close}
          aria-label="Close"
        >
          <X className="size-6" />
        </Button>
        <div className="text-center">
          <p className="text-lg font-bold tabular-nums">
            {format(isoToLocalDate(selectedDate), "dd/MM/yyyy")}
          </p>
          <p className="text-sm text-muted-foreground">Scale Weight</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9"
          disabled={
            !activeEntry || deleteMutation.isPending || saveMutation.isPending
          }
          onClick={() => {
            if (
              !activeEntry ||
              deleteMutation.isPending ||
              saveMutation.isPending
            )
              return
            deleteMutation.mutate(activeEntry.id)
          }}
          aria-label="Delete weigh-in"
        >
          <Trash2 className="size-5" />
        </Button>
      </div>

      <div className="grid grid-cols-[1fr_0.5fr] gap-3">
        <label className="space-y-1.5">
          <span className="text-xs font-bold">Weight</span>
          <div className="relative">
            <Input
              readOnly
              tabIndex={-1}
              inputMode="none"
              value={weightValue}
              onFocus={(event) => event.target.blur()}
              className="pointer-events-none h-12 rounded-xl border-2 pr-11 text-xl"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-base">
              kg
            </span>
          </div>
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-bold">Body Fat</span>
          <div className="relative">
            <Input disabled className="h-12 rounded-xl pr-8" />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-base">
              %
            </span>
          </div>
        </label>
      </div>
      <Button
        type="button"
        className="mt-4 h-12 w-full rounded-xl text-base"
        disabled={
          saveMutation.isPending || deleteMutation.isPending || !weightValue
        }
        onClick={submit}
      >
        Save
      </Button>
      <NumberPad value={weightValue} onChange={setDraftWeight} />
    </div>
  )
}

function NumberPad({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "⌫"]
  return (
    <div className="mt-4 grid grid-cols-3 gap-2">
      {keys.map((key) => (
        <button
          key={key}
          type="button"
          className="h-11 rounded-xl bg-muted text-xl"
          onClick={() => {
            if (key === "⌫") onChange(value.slice(0, -1))
            else if (
              key === "," &&
              !value.includes(",") &&
              !value.includes(".")
            )
              onChange(`${value},`)
            else if (key !== ",") onChange(`${value}${key}`)
          }}
        >
          {key}
        </button>
      ))}
    </div>
  )
}
