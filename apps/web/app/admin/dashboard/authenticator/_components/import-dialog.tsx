"use client";

import { FileUp, Loader2, QrCode, ScanLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

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
  const [tab, setTab] = useState("qr");
  const [uriText, setUriText] = useState("");
  const [importing, setImporting] = useState(false);
  const [qrResult, setQrResult] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [scannerActive, setScannerActive] = useState(false);
  const scannerRef = useRef<HTMLDivElement>(null);
  const html5QrRef = useRef<InstanceType<
    typeof import("html5-qrcode").Html5Qrcode
  > | null>(null);

  useEffect(() => {
    if (!open) {
      setQrResult(null);
      setQrError(null);
      setUriText("");
      setScannerActive(false);
      if (html5QrRef.current) {
        html5QrRef.current.stop().catch(() => {});
        html5QrRef.current = null;
      }
    }
  }, [open]);

  const startCamera = async () => {
    setQrError(null);
    setQrResult(null);

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
      setQrError(
        "Could not access camera. Try uploading a QR code image instead.",
      );
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
        setQrError("QR code does not contain a valid otpauth:// URI.");
      }
    } catch {
      setQrError("Could not read QR code from image.");
    }

    event.target.value = "";
  };

  const handleImport = async () => {
    setImporting(true);

    let uris: string[] = [];

    if (tab === "qr" && qrResult) {
      uris = [qrResult];
    } else if (tab === "text") {
      uris = uriText
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("otpauth://"));
    }

    if (uris.length > 0) {
      await onImport(uris);
    }

    setImporting(false);
  };

  const textUriCount = uriText
    .split("\n")
    .filter((l) => l.trim().startsWith("otpauth://")).length;

  const canImport =
    (tab === "qr" && qrResult) || (tab === "text" && textUriCount > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle>Import Accounts</DialogTitle>
          <DialogDescription>
            Import from a QR code or paste otpauth:// URIs.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="qr" className="flex-1">
              <QrCode className="size-3.5 mr-1.5" />
              QR Code
            </TabsTrigger>
            <TabsTrigger value="text" className="flex-1">
              <FileUp className="size-3.5 mr-1.5" />
              Text / File
            </TabsTrigger>
          </TabsList>

          <TabsContent value="qr" className="mt-4 w-full">
            <div className="flex flex-col gap-3">
              <div
                id="qr-reader"
                ref={scannerRef}
                className={`rounded-lg overflow-hidden bg-accent-strong/5 ${
                  scannerActive ? "min-h-70" : "hidden"
                }`}
              />
              <div id="qr-reader-file" className="hidden" />

              {!scannerActive && !qrResult && (
                <div className="flex flex-col items-center gap-3 py-8 border border-dashed border-border rounded-lg">
                  <QrCode className="size-10 text-muted-foreground/30" />
                  <div className="flex flex-col gap-1 items-center">
                    <Button variant="outline" size="sm" onClick={startCamera}>
                      <ScanLine className="size-3.5 mr-1.5" />
                      Scan with Camera
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                      <label className="cursor-pointer">
                        <FileUp className="size-3.5 mr-1.5" />
                        Upload Image
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
                <div className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2.5">
                  <p className="text-xs text-muted-foreground mb-1">
                    Detected URI
                  </p>
                  <p className="text-xs font-mono break-all text-accent-strong">
                    {qrResult}
                  </p>
                </div>
              )}

              {qrError && (
                <p className="text-xs text-destructive text-center">
                  {qrError}
                </p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="text" className="mt-4 w-full">
            <div className="flex flex-col gap-2">
              <Textarea
                placeholder={
                  "otpauth://totp/GitHub:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub\notpauth://totp/GitLab:user@example.com?secret=..."
                }
                rows={6}
                value={uriText}
                onChange={(e) => setUriText(e.target.value)}
                className="font-mono text-xs resize-none break-all field-sizing-fixed"
              />
              {textUriCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  {textUriCount} valid URI{textUriCount !== 1 ? "s" : ""}{" "}
                  detected
                </p>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={importing}
          >
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={importing || !canImport}>
            {importing ? (
              <>
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                Importing...
              </>
            ) : (
              `Import${tab === "text" && textUriCount > 1 ? ` (${textUriCount})` : ""}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
