import AppIntents
import Foundation

#if canImport(HoursNative)
  // In the app target the shared code lives in the HoursNative pod; the
  // widget extension compiles its own copy of it.
  internal import HoursNative
#endif

/// Every way to clock without opening the app: widget and Live Activity
/// buttons, Control Center, Siri, Shortcuts and the Action Button.
/// `LiveActivityIntent` runs them in the app's process, which is what lets
/// one end or update the Live Activity it was tapped in.

struct CheckInIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Check In"
  static let description = IntentDescription("Start a shift on your default job.")

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let snapshot = try await HoursSync.perform(.clockIn)
    return .result(dialog: "Checked in\(snapshot.jobName.map { " at \($0)" } ?? "").")
  }
}

struct CheckOutIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Check Out"
  static let description = IntentDescription("End the shift that is running.")

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let snapshot = try await HoursSync.perform(.clockOut)
    return .result(
      dialog: "Checked out. \(HoursDates.minutes(snapshot.todayBaseMinutes)) today.")
  }
}

struct StartBreakIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Start Break"

  func perform() async throws -> some IntentResult & ProvidesDialog {
    try await HoursSync.perform(.startBreak)
    return .result(dialog: "On a break.")
  }
}

struct ResumeShiftIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Resume Shift"

  func perform() async throws -> some IntentResult & ProvidesDialog {
    try await HoursSync.perform(.resume)
    return .result(dialog: "Back to work.")
  }
}

/// One button for the Action Button: in when off, out when on.
struct ToggleShiftIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Toggle Shift"
  static let description = IntentDescription("Check in, or check out if a shift is running.")

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let current = try await HoursAPI.refreshOverview()
    if current.status == .off {
      let snapshot = try await HoursSync.perform(.clockIn)
      return .result(dialog: "Checked in\(snapshot.jobName.map { " at \($0)" } ?? "").")
    }
    let snapshot = try await HoursSync.perform(.clockOut)
    return .result(
      dialog: "Checked out. \(HoursDates.minutes(snapshot.todayBaseMinutes)) today.")
  }
}

/// The Control Center toggle's write side.
struct SetShiftIntent: SetValueIntent, LiveActivityIntent {
  static let title: LocalizedStringResource = "Set Shift"

  @Parameter(title: "Checked in")
  var value: Bool

  func perform() async throws -> some IntentResult {
    let current = try await HoursAPI.refreshOverview()
    if value && current.status == .off {
      try await HoursSync.perform(.clockIn)
    } else if !value && current.status != .off {
      try await HoursSync.perform(.clockOut)
    }
    return .result()
  }
}

struct HoursTodayIntent: AppIntent {
  static let title: LocalizedStringResource = "Hours Today"
  static let description = IntentDescription("How long you have worked today and this week.")

  func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<Int> {
    let snapshot = try await HoursAPI.refreshOverview()
    let now = Date()
    let today = snapshot.todayMinutes(at: now)
    var line = "\(HoursDates.minutes(today)) today, \(HoursDates.minutes(snapshot.weekMinutes(at: now))) this week"
    if let target = snapshot.weeklyTargetMinutes {
      line += " of \(HoursDates.minutes(target))"
    }
    switch snapshot.status {
    case .working: line += ". Checked in."
    case .onBreak: line += ". On a break."
    case .off: line += "."
    }
    return .result(value: today, dialog: IntentDialog(stringLiteral: line))
  }
}
