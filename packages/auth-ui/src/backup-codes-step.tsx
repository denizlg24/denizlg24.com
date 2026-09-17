"use client";

import { Button } from "@repo/ui/button";
import { useCopy } from "@repo/ui/copy-button";
import { Check, Copy, Download } from "lucide-react";
import { useState } from "react";
import { StepAlert, StepButton, StepHeading } from "./flow-step";

export function BackupCodesStep({
  codes,
  busy = false,
  onContinue,
}: {
  codes: string[];
  busy?: boolean;
  onContinue: () => void;
}) {
  const { copied, failed, copy } = useCopy(0);
  const [downloaded, setDownloaded] = useState(false);

  const download = () => {
    const blob = new Blob([`${codes.join("\n")}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "deniz-auth-backup-codes.txt";
    anchor.click();
    // Revoking in the same task cancels the download in some browsers, and
    // these codes are shown exactly once — a silent failure is unrecoverable.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setDownloaded(true);
  };

  return (
    <div className="flex flex-col gap-8">
      <StepHeading lede="Each one signs you in once if you lose your authenticator app. They are shown only now, so keep them somewhere safe.">
        Save your backup codes
      </StepHeading>
      {failed ? (
        <StepAlert>
          The clipboard isn't available here. Download the codes or write them
          down.
        </StepAlert>
      ) : null}
      <ol className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border px-4 py-3 font-mono text-sm tabular-nums">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-11"
            onClick={() => void copy(codes.join("\n"))}
          >
            {copied ? (
              <Check aria-hidden="true" />
            ) : (
              <Copy aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-11"
            onClick={download}
          >
            {downloaded ? (
              <Check aria-hidden="true" />
            ) : (
              <Download aria-hidden="true" />
            )}
            {downloaded ? "Downloaded" : "Download"}
          </Button>
        </div>
        <StepButton type="button" busy={busy} onClick={onContinue}>
          I've saved them
        </StepButton>
      </div>
    </div>
  );
}
