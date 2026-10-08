import AppIntents

/// Siri phrases and the Action Button entry. App target only.
struct VoiceShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: AskIntent(),
      phrases: ["Ask \(.applicationName)", "Talk to \(.applicationName)", "Open \(.applicationName) listening"],
      shortTitle: "Ask",
      systemImageName: "waveform")
  }
}
