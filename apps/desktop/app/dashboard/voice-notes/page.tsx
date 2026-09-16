"use client";

import { Suspense } from "react";
import { VoiceNotesPageSkeleton } from "./_components/voice-notes-skeletons";
import { VoiceNotesWorkspace } from "./_components/voice-notes-workspace";

export default function VoiceNotesPage() {
  return (
    <Suspense fallback={<VoiceNotesPageSkeleton />}>
      <VoiceNotesWorkspace />
    </Suspense>
  );
}
