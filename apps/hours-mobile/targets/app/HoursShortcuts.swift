import AppIntents

/// Siri phrases and the Shortcuts / Spotlight / Action Button entries. App
/// target only: one provider per app.
struct HoursShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: ToggleShiftIntent(),
      phrases: ["Toggle my shift in \(.applicationName)", "Clock in or out with \(.applicationName)"],
      shortTitle: "Toggle Shift",
      systemImageName: "clock.badge")
    AppShortcut(
      intent: CheckInIntent(),
      phrases: ["Check in with \(.applicationName)", "Start my shift in \(.applicationName)"],
      shortTitle: "Check In",
      systemImageName: "play.circle")
    AppShortcut(
      intent: CheckOutIntent(),
      phrases: ["Check out with \(.applicationName)", "End my shift in \(.applicationName)"],
      shortTitle: "Check Out",
      systemImageName: "stop.circle")
    AppShortcut(
      intent: StartBreakIntent(),
      phrases: ["Start a break in \(.applicationName)"],
      shortTitle: "Break",
      systemImageName: "cup.and.saucer")
    AppShortcut(
      intent: HoursTodayIntent(),
      phrases: ["How long have I worked in \(.applicationName)", "\(.applicationName) today"],
      shortTitle: "Hours Today",
      systemImageName: "chart.bar")
  }
}
