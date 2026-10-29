"use client";

import { Button } from "@repo/ui/button";
import { FormDialog } from "@repo/ui/form-dialog";
import { Spinner } from "@repo/ui/spinner";
import { Textarea } from "@repo/ui/textarea";
import { FilterTabs } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import { FileUp, MonitorUp, QrCode, ScanLine, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type ImportTab = "qr" | "text";

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (uris: string[]) => Promise<void>;
}

export function ImportDialog({
  open,
  onOpenChange,
  onImport,
}: ImportDialogProps) {
  const [tab, setTab] = useState<ImportTab>("qr");
  const [uriText, setUriText] = useState("");
  const [importing, setImporting] = useState(false);
  const [qrResult, setQrResult] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [scannerActive, setScannerActive] = useState(false);
  const [tabCaptureActive, setTabCaptureActive] = useState(false);
  const [captureStarting, setCaptureStarting] = useState(false);
  const tabVideoRef = useRef<HTMLVideoElement>(null);
  const tabStreamRef = useRef<MediaStream | null>(null);
  const tabScanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captureStartingRef = useRef(false);
  const captureSessionRef = useRef(0);
  const tabRef = useRef(tab);
  const openRef = useRef(open);
  const html5QrRef = useRef<InstanceType<
    typeof import("html5-qrcode").Html5Qrcode
  > | null>(null);

  const stopTabCapture = useCallback(() => {
    captureSessionRef.current += 1;
    if (tabScanTimerRef.current) clearTimeout(tabScanTimerRef.current);
    tabScanTimerRef.current = null;
    tabStreamRef.current?.getTracks().forEach((track) => track.stop());
    tabStreamRef.current = null;
    if (tabVideoRef.current) tabVideoRef.current.srcObject = null;
    setTabCaptureActive(false);
  }, []);

  useEffect(() => {
    openRef.current = open;
    if (!open) {
      setQrResult(null);
      setQrError(null);
      setUriText("");
      setScannerActive(false);
      stopTabCapture();
      if (html5QrRef.current) {
        html5QrRef.current.stop().catch(() => {});
        html5QrRef.current = null;
      }
    }
  }, [open, stopTabCapture]);

  useEffect(
    () => () => {
      openRef.current = false;
      stopTabCapture();
    },
    [stopTabCapture],
  );

  const startTabCapture = async () => {
    if (captureStartingRef.current || tabStreamRef.current) return;
    setQrError(null);
    setQrResult(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setQrError("Tab capture unavailable");
      return;
    }

    const session = ++captureSessionRef.current;
    try {
      captureStartingRef.current = true;
      setCaptureStarting(true);
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      if (
        !openRef.current ||
        tabRef.current !== "qr" ||
        captureSessionRef.current !== session
      ) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const isCurrentCapture = () =>
        openRef.current &&
        tabRef.current === "qr" &&
        captureSessionRef.current === session &&
        tabStreamRef.current === stream;
      tabStreamRef.current = stream;
      setTabCaptureActive(true);
      stream.getVideoTracks()[0]?.addEventListener(
        "ended",
        () => {
          if (isCurrentCapture()) stopTabCapture();
        },
        { once: true },
      );
      const video = tabVideoRef.current;
      if (!video) throw new Error("Video preview unavailable");
      video.srcObject = stream;
      await video.play();
      if (!isCurrentCapture()) return;
      const { Html5Qrcode } = await import("html5-qrcode");
      if (!isCurrentCapture()) return;
      const scanner = new Html5Qrcode("qr-reader-tab");
      const canvas = document.createElement("canvas");

      const scanFrame = async () => {
        if (!isCurrentCapture()) return;
        const retry = () => {
          if (isCurrentCapture())
            tabScanTimerRef.current = setTimeout(() => void scanFrame(), 900);
        };
        if (video.readyState < 2) return retry();
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d");
        if (!context || !canvas.width || !canvas.height) return retry();
        context.drawImage(video, 0, 0);
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/png"),
        );
        if (!isCurrentCapture()) return;
        if (!blob) return retry();
        try {
          const result = await scanner.scanFile(
            new File([blob], "tab-frame.png", { type: "image/png" }),
            false,
          );
          if (!isCurrentCapture()) return;
          if (result.startsWith("otpauth://")) {
            setQrResult(result);
            stopTabCapture();
            return;
          }
          setQrError("No otpauth:// URI in QR");
          stopTabCapture();
        } catch {
          // Most frames do not contain a readable QR code; keep scanning.
        }
        retry();
      };
      void scanFrame();
    } catch (error) {
      if (
        !openRef.current ||
        tabRef.current !== "qr" ||
        captureSessionRef.current !== session
      )
        return;
      stopTabCapture();
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        setQrError("Tab sharing canceled");
      } else {
        setQrError("Could not scan tab");
      }
    } finally {
      captureStartingRef.current = false;
      setCaptureStarting(false);
    }
  };

  const startCamera = async () => {
    setQrError(null);
    setQrResult(null);
    stopTabCapture();

    try {
      const { Html5Qrcode } = await import("html5-qrcode");

      if (html5QrRef.current) {
        await html5QrRef.current.stop().catch(() => {});
      }

      const scanner = new Html5Qrcode("qr-reader");
      html5QrRef.current = scanner;
      setScannerActive(true);

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          if (decodedText.startsWith("otpauth://")) {
            setQrResult(decodedText);
            scanner.stop().catch(() => {});
            setScannerActive(false);
          }
        },
        () => {},
      );
    } catch {
      setQrError("Camera unavailable");
      setScannerActive(false);
    }
  };

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setQrError(null);
    setQrResult(null);

    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("qr-reader-file");
      const result = await scanner.scanFile(file, true);

      if (result.startsWith("otpauth://")) {
        setQrResult(result);
      } else {
        setQrError("No otpauth:// URI in QR");
      }
    } catch {
      setQrError("Could not read QR");
    }

    event.target.value = "";
  };

  const handleImport = async () => {
    let uris: string[] = [];

    if (tab === "qr" && qrResult) {
      uris = [qrResult];
    } else if (tab === "text") {
      uris = uriText
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("otpauth://"));
    }

    if (uris.length === 0) return;
    setImporting(true);
    try {
      await onImport(uris);
    } finally {
      setImporting(false);
    }
  };

  const switchTab = (value: ImportTab) => {
    tabRef.current = value;
    stopTabCapture();
    if (value !== "qr" && html5QrRef.current) {
      void html5QrRef.current.stop().catch(() => {});
      setScannerActive(false);
    }
    setTab(value);
  };

  const textUriCount = uriText
    .split("\n")
    .filter((l) => l.trim().startsWith("otpauth://")).length;

  const canImport =
    (tab === "qr" && qrResult !== null) || (tab === "text" && textUriCount > 0);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Import accounts"
      onSubmit={handleImport}
      submitLabel={
        tab === "text" && textUriCount > 1 ? `Import ${textUriCount}` : "Import"
      }
      submitDisabled={!canImport}
      pending={importing}
      footerStart={
        <FilterTabs
          value={tab}
          onChange={switchTab}
          options={[
            { value: "qr", label: "QR code" },
            { value: "text", label: "URIs" },
          ]}
        />
      }
    >
      {tab === "qr" ? (
        <div className="flex flex-col gap-3">
          <div
            id="qr-reader"
            className={cn(
              "overflow-hidden rounded-lg bg-surface",
              scannerActive ? "min-h-70" : "hidden",
            )}
          />
          <div id="qr-reader-file" className="hidden" />
          <div id="qr-reader-tab" className="hidden" />

          <div className={tabCaptureActive ? "flex flex-col gap-2" : "hidden"}>
            <video
              ref={tabVideoRef}
              muted
              playsInline
              className="max-h-80 w-full rounded-lg bg-black object-contain"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner className="size-3" /> Scanning
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={stopTabCapture}
              >
                <Square /> Stop
              </Button>
            </div>
          </div>

          {!scannerActive && !tabCaptureActive && !qrResult && (
            <div className="flex flex-col items-center gap-4 py-10">
              <QrCode className="size-8 text-muted-foreground/60" />
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={startCamera}
                >
                  <ScanLine /> Camera
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void startTabCapture()}
                  disabled={captureStarting}
                >
                  {captureStarting ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <MonitorUp />
                  )}
                  Tab
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <label className="cursor-pointer">
                    <FileUp /> Image
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                  </label>
                </Button>
              </div>
            </div>
          )}

          {qrResult && (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Detected
              </span>
              <p className="break-all font-mono text-xs text-accent-strong">
                {qrResult}
              </p>
            </div>
          )}

          {qrError && (
            <p className="text-center text-xs text-destructive">{qrError}</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Textarea
            placeholder="otpauth://totp/…"
            rows={12}
            value={uriText}
            onChange={(e) => setUriText(e.target.value)}
            className="field-sizing-fixed resize-none break-all font-mono text-xs"
            aria-label="otpauth URIs"
          />
          <span className="text-xs tabular-nums text-muted-foreground">
            {textUriCount} URI{textUriCount === 1 ? "" : "s"}
          </span>
        </div>
      )}
    </FormDialog>
  );
}
