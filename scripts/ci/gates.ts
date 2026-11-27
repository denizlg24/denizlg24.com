export interface GateTarget {
  id: string;
  /** Workspace packages whose dependency changes (a lockfile diff) select this target. */
  packages: string[];
  /** Globs of changed files that select this target directly. */
  paths: string[];
  /** Extra fields passed through to the workflow matrix entry. */
  matrix?: Record<string, string>;
}

const nativeShared = [
  "packages/expo-ios-targets/**",
  "packages/native-auth/**",
  "packages/native-ui/**",
];

export const gates: Record<string, GateTarget[]> = {
  "personal-ios": [
    {
      id: "stream",
      packages: ["stream-mobile"],
      paths: [
        "apps/stream-mobile/**",
        "packages/auth-sdk/**",
        "packages/expo-ios-targets/**",
        "packages/schemas/src/stream/**",
      ],
      matrix: { app: "Stream", directory: "apps/stream-mobile", extension: "" },
    },
    {
      id: "hours",
      packages: ["hours-mobile"],
      paths: [
        "apps/hours-mobile/**",
        ...nativeShared,
        "packages/utils/src/**",
        "packages/schemas/src/mobile.ts",
        "packages/schemas/src/work-hours.ts",
      ],
      matrix: {
        app: "Hours",
        directory: "apps/hours-mobile",
        extension: "HoursWidgetExtension",
      },
    },
    {
      id: "voice",
      packages: ["voice-mobile"],
      paths: [
        "apps/voice-mobile/**",
        ...nativeShared,
        "packages/tts/**",
        "packages/utils/src/**",
        "packages/schemas/src/mobile.ts",
      ],
      matrix: {
        app: "Voice",
        directory: "apps/voice-mobile",
        extension: "VoiceWidgetExtension",
      },
    },
    {
      id: "location",
      packages: ["location-mobile"],
      paths: [
        "apps/location-mobile/**",
        ...nativeShared,
        "packages/schemas/src/location.ts",
        "packages/schemas/src/mobile.ts",
      ],
      matrix: {
        app: "Location",
        directory: "apps/location-mobile",
        extension: "",
      },
    },
    {
      id: "dashboard",
      packages: ["dashboard-mobile"],
      paths: [
        "apps/dashboard-mobile/**",
        ...nativeShared,
        "packages/utils/src/**",
        "packages/schemas/src/dashboard*.ts",
        "packages/schemas/src/mobile.ts",
      ],
      matrix: {
        app: "Dashboard",
        directory: "apps/dashboard-mobile",
        extension: "DashboardWidgetExtension",
        share: "DashboardShareExtension",
      },
    },
  ],
  "macros-mobile": [
    {
      id: "macros-mobile",
      packages: ["macros-mobile"],
      paths: [
        "apps/macros-mobile/**",
        "packages/macros-core/**",
        "packages/schemas/src/macros/**",
      ],
    },
  ],
  stream: [
    {
      id: "stream",
      packages: [
        "stream",
        "stream-mobile",
        "stream-desktop",
        "@repo/stream-player",
      ],
      paths: [
        "apps/stream/**",
        "apps/stream-mobile/**",
        "apps/stream-desktop/**",
        "packages/stream-player/**",
        "packages/schemas/**",
        "packages/auth-sdk/**",
      ],
    },
  ],
  "agent-canvas": [
    {
      id: "agent-canvas",
      packages: ["agent-canvas"],
      paths: [
        "apps/agent-canvas/**",
        "packages/ui/**",
        "scripts/update-agent-canvas-version*",
        "scripts/changelog-stub.ts",
        "scripts/ci/release-notes*",
      ],
    },
  ],
};
