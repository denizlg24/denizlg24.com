"use client"

import { VisuallyHidden } from "@radix-ui/react-visually-hidden"
import { ArrowLeft, ArrowRight, LoaderCircle, Plus, Trash2 } from "lucide-react"
import { useCallback, useMemo, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { createFoodResponseSchema } from "@/lib/foods/contracts"
import type { NutrientKey } from "@/lib/foods/nutrients"
import { nutrientDefinitionsInput } from "@/lib/foods/nutrients"
import {
  DEFAULT_UNIT_PREF,
  type ToggleableNutrientKey,
  UNIT_OPTIONS,
  type UnitPref,
} from "@/lib/foods/unit-conversions"
import type { FoodSummary } from "../../add/_components/food-detail-drawer"
import { putUserCreatedFood } from "../../add/_lib/food-search-cache"
import { DetailLabel, EULabel, USLabel } from "./nutrient-label-views"

interface ServingDraft {
  uid: string
  label: string
  weightGrams: string
}

interface CreateFoodDrawerProps {
  open: boolean
  barcode: string | null
  autoFocusName?: boolean
  onClose: () => void
  onCreated: (food: FoodSummary) => void
}

type Step = 1 | 2 | 3
type Step2Tab = "serving" | "100g"
type ViewMode = "us" | "eu" | "detail"

const REFERENCE_BASIS = "100g"

function newServingDraft(): ServingDraft {
  return {
    uid: crypto.randomUUID(),
    label: "1 serving",
    weightGrams: "",
  }
}

function buildDefaultDrafts(): Record<string, string> {
  const drafts: Record<string, string> = {}
  for (const def of nutrientDefinitionsInput) {
    drafts[def.key] = ""
  }
  return drafts
}

export function CreateFoodDrawer({
  open,
  barcode,
  autoFocusName = true,
  onClose,
  onCreated,
}: CreateFoodDrawerProps) {
  const [step, setStep] = useState<Step>(1)
  const [name, setName] = useState("")
  const [brand, setBrand] = useState("")
  const [servings, setServings] = useState<ServingDraft[]>(() => [
    newServingDraft(),
  ])
  const [step2Tab, setStep2Tab] = useState<Step2Tab>("serving")
  const [viewMode, setViewMode] = useState<ViewMode>("us")
  const [basisUid, setBasisUid] = useState<string>(REFERENCE_BASIS)
  const [drafts, setDrafts] =
    useState<Record<string, string>>(buildDefaultDrafts)
  const [unitPref, setUnitPref] = useState<UnitPref>(DEFAULT_UNIT_PREF)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const reset = useCallback(() => {
    setStep(1)
    setName("")
    setBrand("")
    setServings([newServingDraft()])
    setStep2Tab("serving")
    setViewMode("us")
    setBasisUid(REFERENCE_BASIS)
    setDrafts(buildDefaultDrafts())
    setUnitPref(DEFAULT_UNIT_PREF)
  }, [])

  const handleClose = () => {
    onClose()
  }

  const setDraft = useCallback((key: NutrientKey, raw: string) => {
    setDrafts((current) => ({ ...current, [key]: raw }))
  }, [])

  const cycleUnit = useCallback((key: ToggleableNutrientKey) => {
    setUnitPref((current) => {
      const options = UNIT_OPTIONS[key]
      const currentValue = current[key]
      const currentIndex = options.findIndex(
        (option) => option.value === currentValue
      )
      const next = options[(currentIndex + 1) % options.length]
      return { ...current, [key]: next.value }
    })
  }, [])

  const setUnit = useCallback((key: ToggleableNutrientKey, value: string) => {
    const options = UNIT_OPTIONS[key]
    const match = options.find((option) => option.value === value)
    if (!match) return
    setUnitPref((current) => ({ ...current, [key]: match.value }))
  }, [])

  const validServings = useMemo(
    () =>
      servings.filter((serving) => {
        const weight = Number.parseFloat(serving.weightGrams)
        return (
          serving.label.trim().length > 0 &&
          Number.isFinite(weight) &&
          weight > 0
        )
      }),
    [servings]
  )

  const activeBasisServing = useMemo(() => {
    if (basisUid === REFERENCE_BASIS) return null
    return validServings.find((serving) => serving.uid === basisUid) ?? null
  }, [basisUid, validServings])

  const scaleFactor = useMemo(() => {
    if (!activeBasisServing) return 1
    const weight = Number.parseFloat(activeBasisServing.weightGrams)
    if (!Number.isFinite(weight) || weight <= 0) return 1
    return weight / 100
  }, [activeBasisServing])

  const basisLabel = useMemo(() => {
    if (!activeBasisServing) return "Per 100g"
    return `Per ${activeBasisServing.label.trim()} (${activeBasisServing.weightGrams}g)`
  }, [activeBasisServing])

  const updateServing = (
    uid: string,
    field: keyof Omit<ServingDraft, "uid">,
    value: string
  ) => {
    setServings((current) =>
      current.map((serving) =>
        serving.uid === uid ? { ...serving, [field]: value } : serving
      )
    )
  }

  const removeServing = (uid: string) => {
    setServings((current) =>
      current.length === 1
        ? current
        : current.filter((serving) => serving.uid !== uid)
    )
  }

  const goNext = () => {
    if (step === 1) {
      if (!name.trim()) {
        toast.error("Food name is required")
        return
      }
      setStep(2)
      return
    }
    if (step === 2) {
      if (validServings.length === 0) {
        toast.error("Add at least one serving with a label and weight")
        return
      }
      if (basisUid === REFERENCE_BASIS && validServings.length > 0) {
        setBasisUid(validServings[0].uid)
      }
      setStep(3)
      return
    }
  }

  const goBack = () => {
    if (step === 1) {
      handleClose()
      return
    }
    setStep((current) => (current === 3 ? 2 : 1))
  }

  const submit = async () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error("Food name is required")
      return
    }
    if (validServings.length === 0) {
      toast.error("At least one serving size is required")
      return
    }

    const servingPayload = [
      { label: "100g", quantity: 100, unit: "g" },
      ...validServings.map((serving) => ({
        label: serving.label.trim(),
        quantity: Number.parseFloat(serving.weightGrams),
        unit: "g",
      })),
    ]

    const nutrients: Partial<Record<NutrientKey, number>> = {}
    for (const def of nutrientDefinitionsInput) {
      const raw = drafts[def.key]
      if (raw == null || raw === "") continue
      const parsed = Number.parseFloat(raw)
      if (Number.isFinite(parsed) && parsed >= 0) {
        nutrients[def.key] = parsed
      }
    }

    setIsSubmitting(true)
    try {
      const response = await fetch("/api/foods", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientMutationId: crypto.randomUUID(),
          barcode: barcode ?? undefined,
          name: trimmedName,
          brand,
          servingSizes: servingPayload,
          nutrients,
        }),
      })

      if (!response.ok) {
        throw new Error(`Food creation failed with ${response.status}`)
      }

      const body = createFoodResponseSchema.parse(await response.json())
      await putUserCreatedFood(body.item, body.fetchedAt)
      onCreated(body.item)
      reset()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create this food"
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const headerTitle =
    step === 1 ? "Add Food" : step === 2 ? "Serving sizes" : "Nutrients"

  return (
    <Drawer
      hideBackdrop
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && handleClose()}
      repositionInputs={false}
    >
      <DrawerContent className="z-70! flex h-[calc(100dvh-4rem)]! max-h-none! flex-col rounded-none">
        <VisuallyHidden>
          <DrawerTitle>Create food</DrawerTitle>
          <DrawerDescription>Add a food for this barcode.</DrawerDescription>
        </VisuallyHidden>

        <div className="flex flex-none items-center gap-2 border-b border-border px-3 py-3">
          <button
            type="button"
            onClick={goBack}
            aria-label={step === 1 ? "Close create food" : "Back"}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </button>
          <h2 className="truncate text-sm font-semibold text-foreground">
            {headerTitle}
          </h2>
          <span className="ml-auto text-xs text-muted-foreground">
            Step {step} of 3
          </span>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {step === 1 && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="create-food-name">Food name</Label>
                <Input
                  id="create-food-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="off"
                  autoFocus={autoFocusName}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-food-brand">Brand</Label>
                <Input
                  id="create-food-brand"
                  value={brand}
                  onChange={(event) => setBrand(event.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-food-barcode">Barcode</Label>
                <Input
                  id="create-food-barcode"
                  value={barcode ?? ""}
                  readOnly
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <Tabs
                value={step2Tab}
                onValueChange={(value) => setStep2Tab(value as Step2Tab)}
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="serving">Serving</TabsTrigger>
                  <TabsTrigger value="100g">100g</TabsTrigger>
                </TabsList>
              </Tabs>

              {step2Tab === "serving" && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Define one or more servings. Each serving is a label plus a
                    weight in grams.
                  </p>
                  <div className="space-y-2">
                    {servings.map((serving, index) => (
                      <div
                        key={serving.uid}
                        className="rounded-md border border-border p-3"
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground">
                            Serving {index + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeServing(serving.uid)}
                            disabled={servings.length === 1}
                            aria-label={`Remove serving ${index + 1}`}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                        <div className="space-y-2">
                          <div className="space-y-1">
                            <Label
                              htmlFor={`serving-label-${serving.uid}`}
                              className="text-xs text-muted-foreground"
                            >
                              Label
                            </Label>
                            <Input
                              id={`serving-label-${serving.uid}`}
                              value={serving.label}
                              onChange={(event) =>
                                updateServing(
                                  serving.uid,
                                  "label",
                                  event.target.value
                                )
                              }
                              placeholder="1 packet"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label
                              htmlFor={`serving-weight-${serving.uid}`}
                              className="text-xs text-muted-foreground"
                            >
                              Weight (g)
                            </Label>
                            <Input
                              id={`serving-weight-${serving.uid}`}
                              value={serving.weightGrams}
                              onChange={(event) => {
                                const normalized = event.target.value.replace(
                                  /,/g,
                                  "."
                                )
                                if (
                                  normalized !== "" &&
                                  !/^\d*\.?\d*$/.test(normalized)
                                ) {
                                  return
                                }
                                updateServing(
                                  serving.uid,
                                  "weightGrams",
                                  normalized
                                )
                              }}
                              inputMode="decimal"
                              placeholder="30"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() =>
                        setServings((current) => [
                          ...current,
                          newServingDraft(),
                        ])
                      }
                    >
                      <Plus className="size-4" />
                      Add serving
                    </Button>
                  </div>
                </div>
              )}

              {step2Tab === "100g" && (
                <div className="rounded-md border border-border p-4">
                  <p className="text-xs text-muted-foreground">Reference</p>
                  <p className="mt-1 text-sm font-medium">100 grams</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Always available alongside your custom servings. Useful for
                    entering nutrients per 100g on the next step.
                  </p>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <Tabs
                value={viewMode}
                onValueChange={(value) => {
                  const next = value as ViewMode
                  setViewMode(next)
                  if (next === "eu") {
                    setBasisUid(REFERENCE_BASIS)
                  }
                }}
              >
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="us">US Label</TabsTrigger>
                  <TabsTrigger value="eu">EU Label</TabsTrigger>
                  <TabsTrigger value="detail">Detail</TabsTrigger>
                </TabsList>
              </Tabs>

              {viewMode !== "eu" && (
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">
                    Values per
                  </Label>
                  <Select value={basisUid} onValueChange={setBasisUid}>
                    <SelectTrigger size="sm" className="h-8 flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={REFERENCE_BASIS}>100g</SelectItem>
                      {validServings.map((serving) => (
                        <SelectItem key={serving.uid} value={serving.uid}>
                          {serving.label.trim()} ({serving.weightGrams}g)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {viewMode === "us" && (
                <USLabel
                  drafts={drafts}
                  setDraft={setDraft}
                  scaleFactor={scaleFactor}
                  basisLabel={basisLabel}
                  unitPref={unitPref}
                  cycleUnit={cycleUnit}
                  setUnit={setUnit}
                />
              )}
              {viewMode === "eu" && (
                <EULabel
                  drafts={drafts}
                  setDraft={setDraft}
                  scaleFactor={1}
                  basisLabel="Per 100g"
                  unitPref={unitPref}
                  cycleUnit={cycleUnit}
                  setUnit={setUnit}
                />
              )}
              {viewMode === "detail" && (
                <DetailLabel
                  drafts={drafts}
                  setDraft={setDraft}
                  scaleFactor={scaleFactor}
                  basisLabel={basisLabel}
                  unitPref={unitPref}
                  cycleUnit={cycleUnit}
                  setUnit={setUnit}
                />
              )}
            </div>
          )}
        </div>

        <div className="flex flex-none items-center gap-2 border-t border-border bg-background px-3 pt-3 pb-safe-end">
          {step < 3 ? (
            <Button
              type="button"
              onClick={goNext}
              className="h-11 w-full rounded-full bg-foreground text-background hover:bg-foreground/90"
            >
              Next
              <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={submit}
              disabled={isSubmitting}
              className="h-11 w-full rounded-full bg-foreground text-background hover:bg-foreground/90"
            >
              {isSubmitting ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  Creating
                </>
              ) : (
                "Create Food"
              )}
            </Button>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
