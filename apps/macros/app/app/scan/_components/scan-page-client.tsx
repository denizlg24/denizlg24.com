"use client"

import type { IScannerControls } from "@zxing/browser"
import { Barcode, CameraOff, LoaderCircle, Plus, RotateCcw } from "lucide-react"
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { z } from "zod"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useHydrated } from "@/hooks/use-hydrated"
import { useDailyCalorieSummary } from "@/lib/app-cache/api"
import { foodSearchItemSchema, type LogFoodInput } from "@/lib/foods/contracts"
import {
  readPendingFoods,
  subscribeToPendingFoods,
  writePendingFoods,
} from "@/lib/foods/pending-foods"
import type { OptimisticDailyMacros } from "@/lib/optimistic-nutrition"
import type { DailyCalorieSummary } from "@/lib/queries/calorie-summary"
import { cn } from "@/lib/utils"
import {
  dateFromIsoDate,
  formatHourLabel,
  getHourInTimezone,
  getPendingCalories,
  HeaderChips,
  inferMealType,
  NavTabs,
  type PendingFood,
  PendingFoodsSheet,
} from "../../add/_components/add-food-shared"
import {
  FoodDetailDrawer,
  type FoodSummary,
} from "../../add/_components/food-detail-drawer"
import { useLogPendingFoods } from "../../add/_components/use-log-pending-foods"
import { CreateFoodDrawer } from "./create-food-drawer"

const barcodeLookupResponseSchema = z.object({
  item: foodSearchItemSchema,
  fetchedAt: z.string(),
})

const SCAN_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "itf",
] as const

const CAMERA_STREAM_RELEASE_DELAY_MS = 30_000
const CAMERA_ALLOWED_STORAGE_KEY = "macros.scan.cameraAllowed"
const CAMERA_CONSTRAINTS = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
} as const satisfies MediaStreamConstraints

let retainedCameraStream: MediaStream | null = null
let retainedCameraReleaseTimeout: number | null = null

interface DetectedBarcodeResult {
  rawValue: string
  format: string
}

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcodeResult[]>
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike
  getSupportedFormats(): Promise<readonly string[]>
}

type ScanState =
  | "starting"
  | "scanning"
  | "looking-up"
  | "found"
  | "not-found"
  | "camera-error"
  | "lookup-error"

class FoodLookupError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

async function readJsonResponse(response: Response) {
  if (!response.ok) {
    throw new FoodLookupError(
      response.status === 404
        ? "No food found for this barcode."
        : `Request failed with ${response.status}`,
      response.status
    )
  }

  const body: unknown = await response.json()
  return body
}

function getCameraUnavailableMessage(error?: unknown) {
  if (!window.isSecureContext) {
    return "Camera access requires HTTPS on iPhone. Open the app from a secure URL and try again."
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return "This browser does not expose camera scanning on this page."
  }

  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "Camera permission was denied. Allow camera access in Safari and try again."
    }

    if (error.name === "NotFoundError") {
      return "No camera was found on this device."
    }
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return "Camera permission is required to scan barcodes."
}

async function getNativeBarcodeDetector(): Promise<BarcodeDetectorConstructor | null> {
  const barcodeWindow = window as Window & {
    BarcodeDetector?: BarcodeDetectorConstructor
  }

  if (barcodeWindow.BarcodeDetector) {
    const supported = await barcodeWindow.BarcodeDetector.getSupportedFormats()
    if (SCAN_FORMATS.some((format) => supported.includes(format))) {
      return barcodeWindow.BarcodeDetector
    }
  }

  return null
}

function hasLiveVideoTrack(stream: MediaStream) {
  return stream.getVideoTracks().some((track) => track.readyState === "live")
}

function stopStream(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop())
}

async function getRetainedCameraStream() {
  if (retainedCameraReleaseTimeout != null) {
    window.clearTimeout(retainedCameraReleaseTimeout)
    retainedCameraReleaseTimeout = null
  }

  if (retainedCameraStream && hasLiveVideoTrack(retainedCameraStream)) {
    return retainedCameraStream
  }

  retainedCameraStream =
    await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
  try {
    window.localStorage.setItem(CAMERA_ALLOWED_STORAGE_KEY, "true")
  } catch {
    // Camera reuse still works for the active session if storage is unavailable.
  }
  return retainedCameraStream
}

function releaseRetainedCameraStream(stream: MediaStream) {
  if (stream !== retainedCameraStream) {
    stopStream(stream)
    return
  }

  if (retainedCameraReleaseTimeout != null) {
    window.clearTimeout(retainedCameraReleaseTimeout)
  }

  retainedCameraReleaseTimeout = window.setTimeout(() => {
    if (retainedCameraStream === stream) {
      stopStream(stream)
      retainedCameraStream = null
    }
    retainedCameraReleaseTimeout = null
  }, CAMERA_STREAM_RELEASE_DELAY_MS)
}

function ScanFallback() {
  return (
    <div className="flex h-dvh flex-col">
      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <Skeleton className="h-9 w-20 rounded-full" />
        </div>
        <Skeleton className="h-9 w-24 rounded-full" />
        <div />
      </div>
      <Skeleton className="h-11 w-full rounded-none" />
      <div className="flex-1 bg-muted" />
    </div>
  )
}

function ScannerViewport({
  videoRef,
  state,
  message,
  barcode,
  onRetry,
  onCreateFood,
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  state: ScanState
  message: string | null
  barcode: string | null
  onRetry: () => void
  onCreateFood: () => void
}) {
  const busy = state === "starting" || state === "looking-up"
  const error = state === "camera-error" || state === "lookup-error"
  const notFound = state === "not-found"

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
      <video
        ref={videoRef}
        className={cn(
          "absolute inset-0 h-full w-full object-cover",
          error && "opacity-35"
        )}
        muted
        playsInline
        autoPlay
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0,transparent_34%,rgba(0,0,0,0.48)_35%,rgba(0,0,0,0.72)_100%)]" />
      <div className="pointer-events-none absolute inset-x-8 top-1/2 h-32 -translate-y-1/2 rounded-lg border border-white/80">
        <div className="-left-px -top-px absolute size-8 border-white border-t-4 border-l-4" />
        <div className="-right-px -top-px absolute size-8 border-white border-t-4 border-r-4" />
        <div className="-bottom-px -left-px absolute size-8 border-white border-b-4 border-l-4" />
        <div className="-right-px -bottom-px absolute size-8 border-white border-r-4 border-b-4" />
        <div className="absolute inset-x-5 top-1/2 h-px bg-white/70 shadow-[0_0_16px_rgba(255,255,255,0.75)]" />
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/35 to-transparent px-4 pt-10 pb-safe-end">
        <div className="mx-auto flex max-w-sm items-center gap-3 rounded-lg bg-background/92 px-3 py-3 text-foreground shadow-lg backdrop-blur">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
            {busy ? (
              <LoaderCircle className="size-5 animate-spin" />
            ) : error || notFound ? (
              <CameraOff className="size-5" />
            ) : (
              <Barcode className="size-5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {state === "looking-up"
                ? "Finding food"
                : notFound
                  ? "Barcode not found"
                  : error
                    ? "Scanner paused"
                    : "Align the barcode"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {notFound
                ? "Add nutrition details for this barcode."
                : (barcode ?? message ?? "Place the barcode inside the frame.")}
            </p>
          </div>
          {notFound ? (
            <button
              type="button"
              onClick={onCreateFood}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-foreground px-3 text-xs font-semibold text-background"
            >
              <Plus className="size-4" />
              Add
            </button>
          ) : null}
          {error ? (
            <button
              type="button"
              onClick={onRetry}
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background"
              aria-label="Restart scanner"
            >
              <RotateCcw className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ScanLogic({
  calorieSummary,
}: {
  calorieSummary: DailyCalorieSummary
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const zxingControlsRef = useRef<IScannerControls | null>(null)
  const scanFrameRef = useRef<number | null>(null)
  const lookupInFlightRef = useRef(false)
  const lastLookupRef = useRef<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [scanKey, setScanKey] = useState(0)
  const [scanState, setScanState] = useState<ScanState>("starting")
  const [message, setMessage] = useState<string | null>(null)
  const [detectedBarcode, setDetectedBarcode] = useState<string | null>(null)
  const [selectedFood, setSelectedFood] = useState<FoodSummary | null>(null)
  const [createFoodOpen, setCreateFoodOpen] = useState(false)
  const [pendingFoods, setPendingFoods] = useState<PendingFood[]>([])
  const [pendingSheetOpen, setPendingSheetOpen] = useState(false)
  const [extraConsumed, setExtraConsumed] = useState(0)
  const [selectedDate, setSelectedDate] = useState(() =>
    dateFromIsoDate(calorieSummary.today)
  )
  const [selectedHour, setSelectedHour] = useState(() =>
    getHourInTimezone(new Date(), calorieSummary.timezone)
  )

  const todayDate = useMemo(
    () => dateFromIsoDate(calorieSummary.today),
    [calorieSummary.today]
  )

  const eatenAt = useMemo(() => {
    const d = new Date(selectedDate)
    const now = new Date()
    const minute =
      d.toDateString() === now.toDateString() && selectedHour === now.getHours()
        ? Math.floor(now.getMinutes() / 15) * 15
        : 0
    d.setHours(selectedHour, minute, 0, 0)
    return d.toISOString()
  }, [selectedDate, selectedHour])

  const logDate = useMemo(() => {
    const d = selectedDate
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  }, [selectedDate])

  const stopCamera = useCallback(() => {
    if (scanFrameRef.current != null) {
      window.cancelAnimationFrame(scanFrameRef.current)
      scanFrameRef.current = null
    }
    zxingControlsRef.current?.stop()
    zxingControlsRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    if (streamRef.current) {
      releaseRetainedCameraStream(streamRef.current)
    }
    streamRef.current = null
  }, [])

  const lookupBarcode = useCallback(async (barcode: string) => {
    if (lookupInFlightRef.current || lastLookupRef.current === barcode) return

    lookupInFlightRef.current = true
    lastLookupRef.current = barcode
    setDetectedBarcode(barcode)
    setScanState("looking-up")
    setMessage(null)

    try {
      const response = await fetch(
        `/api/foods/barcode/${encodeURIComponent(barcode)}`,
        { cache: "no-store" }
      )
      const body = barcodeLookupResponseSchema.parse(
        await readJsonResponse(response)
      )
      setSelectedFood(body.item)
      setScanState("found")
    } catch (error) {
      if (error instanceof FoodLookupError && error.status === 404) {
        setScanState("not-found")
        setMessage(error.message)
        setCreateFoodOpen(true)
        lastLookupRef.current = null
        return
      }

      setScanState("lookup-error")
      setMessage(
        error instanceof Error ? error.message : "Could not find that barcode."
      )
      lastLookupRef.current = null
    } finally {
      lookupInFlightRef.current = false
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.add("macros-add-food-scroll-lock")
    const storedFoods = readPendingFoods()
    if (storedFoods.length > 0) {
      setPendingFoods(storedFoods)
    }
    const unsubscribe = subscribeToPendingFoods(setPendingFoods)

    return () => {
      unsubscribe()
      document.documentElement.classList.remove("macros-add-food-scroll-lock")
    }
  }, [])

  useEffect(() => {
    const vv = window.visualViewport
    const el = containerRef.current
    if (!vv || !el) return

    function sync() {
      if (!el) return
      el.style.height = `${vv!.height}px`
      el.style.transform = `translateY(${vv!.offsetTop}px)`
    }

    sync()
    vv.addEventListener("resize", sync)
    vv.addEventListener("scroll", sync)

    return () => {
      vv.removeEventListener("resize", sync)
      vv.removeEventListener("scroll", sync)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const scannerRestart = scanKey

    async function startScanner() {
      void scannerRestart
      stopCamera()
      setScanState("starting")
      setMessage(null)
      setDetectedBarcode(null)
      lastLookupRef.current = null

      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          throw new Error(getCameraUnavailableMessage())
        }

        const Detector = await getNativeBarcodeDetector()
        const stream = await getRetainedCameraStream()
        if (cancelled) {
          releaseRetainedCameraStream(stream)
          return
        }

        streamRef.current = stream

        if (!Detector) {
          const video = videoRef.current
          if (!video) return
          video.srcObject = stream
          await video.play()

          const { BrowserMultiFormatReader } = await import("@zxing/browser")
          const reader = new BrowserMultiFormatReader()
          const controls = await reader.decodeFromVideoElement(
            video,
            (result) => {
              const text = result?.getText().trim()
              if (!text || lookupInFlightRef.current) return
              zxingControlsRef.current?.stop()
              zxingControlsRef.current = null
              void lookupBarcode(text)
            }
          )
          if (cancelled) {
            controls.stop()
            return
          }
          zxingControlsRef.current = controls
          setScanState("scanning")
          return
        }

        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()

        const supported = await Detector.getSupportedFormats()
        const formats = SCAN_FORMATS.filter((format) =>
          supported.includes(format)
        )
        const detector = new Detector({ formats })
        setScanState("scanning")

        let lastScanAt = 0
        const scan = async (now: number) => {
          if (cancelled || lookupInFlightRef.current) return
          scanFrameRef.current = window.requestAnimationFrame(scan)
          if (
            now - lastScanAt < 250 ||
            video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
          ) {
            return
          }

          lastScanAt = now
          try {
            const codes = await detector.detect(video)
            const code = codes.find((item) => item.rawValue.trim().length > 0)
            if (code) {
              if (scanFrameRef.current != null) {
                window.cancelAnimationFrame(scanFrameRef.current)
                scanFrameRef.current = null
              }
              void lookupBarcode(code.rawValue.trim())
            }
          } catch {
            setMessage("Keep the barcode steady in the frame.")
          }
        }

        scanFrameRef.current = window.requestAnimationFrame(scan)
      } catch (error) {
        setScanState("camera-error")
        setMessage(getCameraUnavailableMessage(error))
      }
    }

    void startScanner()

    return () => {
      cancelled = true
      stopCamera()
    }
  }, [lookupBarcode, scanKey, stopCamera])

  const handleRetry = useCallback(() => {
    setScanKey((key) => key + 1)
  }, [])

  const pendingCalories = useMemo(
    () =>
      pendingFoods
        .filter((food) => food.input.logDate === calorieSummary.today)
        .reduce((sum, food) => sum + getPendingCalories(food), 0),
    [pendingFoods, calorieSummary.today]
  )

  const addToPending = useCallback(
    (input: LogFoodInput, macros: OptimisticDailyMacros) => {
      if (!selectedFood) return Promise.resolve()
      const clientMutationId = crypto.randomUUID()
      setPendingFoods((prev) => {
        const next = [
          ...prev,
          {
            uid: clientMutationId,
            food: selectedFood,
            input: { ...input, clientMutationId },
            macros,
          },
        ]
        window.queueMicrotask(() => writePendingFoods(next))
        return next
      })
      return Promise.resolve()
    },
    [selectedFood]
  )

  const removePending = useCallback((uid: string) => {
    setPendingFoods((prev) => {
      const next = prev.filter((food) => food.uid !== uid)
      window.queueMicrotask(() => writePendingFoods(next))
      return next
    })
  }, [])

  const { isCommitting, logAllPending } = useLogPendingFoods({
    pendingFoods,
    setPendingFoods,
    setPendingSheetOpen,
    setExtraConsumed,
    today: calorieSummary.today,
  })

  const handleStage = useCallback(
    async (input: LogFoodInput, macros: OptimisticDailyMacros) => {
      await addToPending(input, macros)
      setPendingSheetOpen(true)
    },
    [addToPending]
  )

  return (
    <div
      ref={containerRef}
      className="macros-fixed-inset-x fixed top-0 z-50 flex flex-col overflow-hidden bg-background"
    >
      <div className="flex-none bg-background">
        <HeaderChips
          selectedDate={selectedDate}
          selectedHour={selectedHour}
          todayDate={todayDate}
          onDateChange={setSelectedDate}
          onHourChange={setSelectedHour}
          calorieSummary={{
            ...calorieSummary,
            consumed: calorieSummary.consumed + extraConsumed,
          }}
          pendingCount={pendingFoods.length}
          pendingCalories={pendingCalories}
          onViewPending={() => setPendingSheetOpen(true)}
        />
        <NavTabs />
      </div>

      <ScannerViewport
        videoRef={videoRef}
        state={scanState}
        message={message ?? `${formatHourLabel(selectedHour)} log time`}
        barcode={detectedBarcode}
        onRetry={handleRetry}
        onCreateFood={() => setCreateFoodOpen(true)}
      />

      <FoodDetailDrawer
        food={selectedFood}
        calorieSummary={calorieSummary}
        eatenAt={eatenAt}
        logDate={logDate}
        mealType={inferMealType(selectedHour)}
        isLogging={false}
        onClose={() => {
          setSelectedFood(null)
          handleRetry()
        }}
        onLog={handleStage}
      />

      <CreateFoodDrawer
        open={createFoodOpen}
        barcode={detectedBarcode}
        onClose={() => {
          setCreateFoodOpen(false)
          handleRetry()
        }}
        onCreated={(food) => {
          setCreateFoodOpen(false)
          setSelectedFood(food)
          setScanState("found")
        }}
      />

      <PendingFoodsSheet
        open={pendingSheetOpen}
        onClose={() => setPendingSheetOpen(false)}
        pendingFoods={pendingFoods}
        onRemove={removePending}
        onCommit={logAllPending}
        isLogging={isCommitting}
      />
    </div>
  )
}

export function ScanPageClient() {
  const hydrated = useHydrated()
  const { data, error, isError, refetch } = useDailyCalorieSummary()

  if (!hydrated) {
    return <ScanFallback />
  }

  if (isError && !data) {
    return (
      <div className="flex h-dvh flex-col px-4 pt-4">
        <Alert variant="destructive">
          <AlertTitle>Could not load today's summary</AlertTitle>
          <AlertDescription>
            {error instanceof Error
              ? error.message
              : "Refresh your nutrition snapshot and try again."}
          </AlertDescription>
          <div className="mt-3">
            <Button type="button" variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        </Alert>
      </div>
    )
  }

  if (!data) {
    return <ScanFallback />
  }

  return <ScanLogic calorieSummary={data} />
}
