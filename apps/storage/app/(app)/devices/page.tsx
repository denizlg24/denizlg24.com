"use client";

import { useState } from "react";
import {
  AddDeviceWizard,
  type IssuedDevice,
} from "./_components/add-device-wizard";
import { DeviceList } from "./_components/device-list";

type Mode = { kind: "list" } | { kind: "wizard"; resume?: IssuedDevice };

export default function DevicesPage() {
  const [mode, setMode] = useState<Mode>({ kind: "list" });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-4 pb-3 pt-3 md:px-6">
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
          Devices
        </h1>
        <p className="text-sm text-muted-foreground">
          Connect a computer so Deniz Cloud shows up as a drive in Finder or
          Explorer.
        </p>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6">
        <div className="mx-auto max-w-2xl">
          {mode.kind === "wizard" ? (
            <AddDeviceWizard
              key={mode.resume?.id ?? "new"}
              resume={mode.resume}
              onDone={() => setMode({ kind: "list" })}
              onCancel={() => setMode({ kind: "list" })}
            />
          ) : (
            <DeviceList
              onAdd={() => setMode({ kind: "wizard" })}
              onResume={(resume) => setMode({ kind: "wizard", resume })}
            />
          )}
        </div>
      </div>
    </div>
  );
}
