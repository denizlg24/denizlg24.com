import AppIntents
import Foundation
import WidgetKit

#if canImport(DashboardNative)
  // In the app target the shared code lives in the DashboardNative pod; the
  // widget extension compiles its own copy of it.
  internal import DashboardNative
#endif

/// The interactive todo widget's button. Runs in whichever process drew the
/// widget; the session is in the App Group keychain either way.
struct ToggleBoardTodoIntent: AppIntent {
  static let title: LocalizedStringResource = "Tick Board Todo"
  static let isDiscoverable = false

  @Parameter(title: "List") var elementId: String
  @Parameter(title: "Item") var itemId: String
  @Parameter(title: "Done") var completed: Bool

  init() {}

  init(elementId: String, itemId: String, completed: Bool) {
    self.elementId = elementId
    self.itemId = itemId
    self.completed = completed
  }

  func perform() async throws -> some IntentResult {
    _ = try await DashboardAPI.request(
      "whiteboard/today/elements/\(elementId)/items", method: "PATCH",
      body: ["update": [["id": itemId, "completed": completed]]])
    try await TodayStore.refresh()
    WidgetCenter.shared.reloadAllTimelines()
    return .result()
  }
}

struct AddBoardTodoIntent: AppIntent {
  static let title: LocalizedStringResource = "Add Board Todo"
  static let description = IntentDescription("Adds a todo to today's board.")

  @Parameter(title: "Todo") var text: String

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return .result(dialog: "Nothing to add.") }
    let today = try await TodayStore.refresh()
    if let list = today.payload.board.todos.first?.elementId {
      _ = try await DashboardAPI.request(
        "whiteboard/today/elements/\(list)/items", method: "PATCH",
        body: ["add": [["text": trimmed]]])
    } else {
      // No list yet: the server places a new one below everything else.
      _ = try await DashboardAPI.request(
        "whiteboard/today/elements", method: "POST",
        body: [
          "elements": [
            [
              "type": "component", "componentType": "todo-list",
              "data": ["items": [["text": trimmed, "completed": false]]],
            ]
          ]
        ])
    }
    try await TodayStore.refresh()
    WidgetCenter.shared.reloadAllTimelines()
    return .result(dialog: "Added.")
  }
}

struct AddNoteIntent: AppIntent {
  static let title: LocalizedStringResource = "Add Note"
  static let description = IntentDescription("Saves a note and files it.")

  @Parameter(title: "Note") var text: String

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return .result(dialog: "Nothing to save.") }
    let note = try await NotesAPI.create(text: trimmed)
    try? await NotesAPI.categorize(note)
    return .result(dialog: "Saved.")
  }
}

struct OpenTriageIntent: AppIntent {
  static let title: LocalizedStringResource = "Open Triage"
  static let openAppWhenRun = true

  func perform() async throws -> some IntentResult & OpensIntent {
    .result(opensIntent: OpenURLIntent(URL(string: "dashboard://inbox?view=triage")!))
  }
}

struct TodayAgendaIntent: AppIntent {
  static let title: LocalizedStringResource = "Today's Agenda"
  static let description = IntentDescription("What is on today, and what is due next.")

  func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<String> {
    let today = try await TodayStore.refresh().payload
    let line = AgendaText.spoken(today, now: Date())
    return .result(value: line, dialog: IntentDialog(stringLiteral: line))
  }
}

enum AgendaText {
  private static let time: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateFormat = "HH:mm"
    return formatter
  }()

  static func spoken(_ today: TodayPayload, now: Date) -> String {
    let upcoming = today.upcoming(after: now)
    var parts: [String] = []
    if upcoming.isEmpty {
      parts.append("Nothing else on today.")
    } else {
      let items = upcoming.map { item -> String in
        if item.allDay { return item.title }
        return "\(item.startDate.map { time.string(from: $0) } ?? "") \(item.title)"
      }
      parts.append(items.joined(separator: ", ") + ".")
    }
    if let deadline = today.nextDeadline {
      parts.append("Next due: \(deadline.title) for \(deadline.courseName).")
    }
    let open = today.board.todos.filter { !$0.completed }.count
    if open > 0 { parts.append("\(open) open on the board.") }
    return parts.joined(separator: " ")
  }
}
