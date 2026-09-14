"use client";

import { NetworkDriveSection } from "./_components/network-drive-section";

export default function DevicesPage() {
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
          <NetworkDriveSection />
        </div>
      </div>
    </div>
  );
}
