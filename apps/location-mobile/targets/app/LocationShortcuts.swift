import AppIntents

/// Siri phrases and the Shortcuts / Spotlight / Action Button entries. App
/// target only: one provider per app.
struct LocationShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: ToggleExploringIntent(),
      phrases: ["Toggle exploring in \(.applicationName)"],
      shortTitle: "Toggle Exploring",
      systemImageName: "figure.walk.motion")
    AppShortcut(
      intent: StartExploringIntent(),
      phrases: ["Start exploring with \(.applicationName)", "Explore with \(.applicationName)"],
      shortTitle: "Start Exploring",
      systemImageName: "figure.walk")
    AppShortcut(
      intent: StopExploringIntent(),
      phrases: ["Stop exploring with \(.applicationName)"],
      shortTitle: "Stop Exploring",
      systemImageName: "stop.circle")
  }
}
