import AppIntents

/// Siri phrases and the Shortcuts / Spotlight entries. App target only: one
/// provider per app.
struct DashboardShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: TodayAgendaIntent(),
      phrases: ["What's on today in \(.applicationName)", "\(.applicationName) agenda"],
      shortTitle: "Today's Agenda",
      systemImageName: "calendar")
    AppShortcut(
      intent: AddNoteIntent(),
      phrases: ["Add a note in \(.applicationName)", "Save a note to \(.applicationName)"],
      shortTitle: "Add Note",
      systemImageName: "note.text.badge.plus")
    AppShortcut(
      intent: AddBoardTodoIntent(),
      phrases: ["Add a todo in \(.applicationName)", "Add to my board in \(.applicationName)"],
      shortTitle: "Add Board Todo",
      systemImageName: "checklist")
    AppShortcut(
      intent: OpenTriageIntent(),
      phrases: ["Open triage in \(.applicationName)"],
      shortTitle: "Open Triage",
      systemImageName: "tray")
  }
}
