import Foundation
import WidgetKit

/// Must match `snapshotKey` in modules/macros-widgets/ios/MacrosWidgetsModule.swift.
private let SNAPSHOT_KEY = "snapshot"

/// `WidgetSnapshot` in src/features/widgets/snapshot.ts, in display units.
struct WidgetSnapshot: Codable {
  struct Energy: Codable {
    var unit: String
    var eaten: Double
    var target: Double?
    var color: String
    var overColor: String
  }

  struct Macro: Codable, Identifiable {
    var key: String
    var label: String
    var eaten: Double
    var target: Double?
    var color: String
    var id: String { key }
  }

  struct Weight: Codable {
    var unit: String
    var label: String
    var value: Double
    var change: Double?
    var changeDays: Int
    var points: [Double]
    var lastWeighIn: String?
  }

  var version: Int
  var day: String
  var timeZone: String
  var updatedAt: String
  var mode: String
  var energy: Energy
  var macros: [Macro]
  var weight: Weight?
}

enum SnapshotStore {
  static func load() -> WidgetSnapshot? {
    guard
      let group = Bundle.main.object(forInfoDictionaryKey: "MacrosAppGroup") as? String,
      let defaults = UserDefaults(suiteName: group),
      let json = defaults.string(forKey: SNAPSHOT_KEY),
      let data = json.data(using: .utf8),
      let snapshot = try? JSONDecoder().decode(WidgetSnapshot.self, from: data),
      snapshot.version == 1
    else { return nil }
    return snapshot
  }
}

extension WidgetSnapshot {
  var calendar: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: timeZone) ?? .current
    return calendar
  }

  func isoDay(_ date: Date) -> String {
    let parts = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
  }

  /// The snapshot as it reads at `date`. A later day in the profile's zone has
  /// nothing eaten yet; its targets are assumed to be the last ones known.
  func at(_ date: Date) -> WidgetSnapshot {
    let today = isoDay(date)
    guard today > day else { return self }
    var next = self
    next.day = today
    next.energy.eaten = 0
    next.macros = macros.map { macro in
      var reset = macro
      reset.eaten = 0
      return reset
    }
    return next
  }

  func nextMidnight(after date: Date) -> Date {
    calendar.nextDate(
      after: date,
      matching: DateComponents(hour: 0, minute: 0, second: 0),
      matchingPolicy: .nextTime
    ) ?? date.addingTimeInterval(60 * 60)
  }

  var weighedToday: Bool { weight?.lastWeighIn == day }
}

struct SnapshotEntry: TimelineEntry {
  let date: Date
  let snapshot: WidgetSnapshot?
}

/// The app rewrites the snapshot and reloads every timeline whenever its
/// dashboard changes; the timeline itself only has to turn the day over.
struct SnapshotProvider: TimelineProvider {
  func placeholder(in context: Context) -> SnapshotEntry {
    SnapshotEntry(date: .now, snapshot: .sample)
  }

  func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
    let stored = SnapshotStore.load()
    let snapshot = stored ?? (context.isPreview ? .sample : nil)
    completion(SnapshotEntry(date: .now, snapshot: snapshot?.at(.now)))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
    let now = Date.now
    guard let snapshot = SnapshotStore.load() else {
      completion(Timeline(entries: [SnapshotEntry(date: now, snapshot: nil)], policy: .never))
      return
    }
    let midnight = snapshot.nextMidnight(after: now)
    completion(
      Timeline(
        entries: [
          SnapshotEntry(date: now, snapshot: snapshot.at(now)),
          SnapshotEntry(date: midnight, snapshot: snapshot.at(midnight)),
        ],
        policy: .after(snapshot.nextMidnight(after: midnight))
      )
    )
  }
}

extension WidgetSnapshot {
  /// The widget gallery's preview before the app has written anything.
  static let sample = WidgetSnapshot(
    version: 1,
    day: "2026-01-01",
    timeZone: TimeZone.current.identifier,
    updatedAt: "",
    mode: "remaining",
    energy: Energy(unit: "kcal", eaten: 1460, target: 2300, color: "#5f9df7", overColor: "#c4834a"),
    macros: [
      Macro(key: "protein", label: "Protein", eaten: 112, target: 160, color: "#ff8468"),
      Macro(key: "carbs", label: "Carbs", eaten: 148, target: 240, color: "#62bd8b"),
      Macro(key: "fat", label: "Fat", eaten: 46, target: 75, color: "#ffd15c"),
    ],
    weight: Weight(
      unit: "kg",
      label: "Trend",
      value: 78.4,
      change: -1.3,
      changeDays: 29,
      points: [79.7, 79.6, 79.6, 79.4, 79.3, 79.3, 79.1, 79.0, 78.9, 78.9, 78.7, 78.6, 78.6, 78.4],
      lastWeighIn: "2026-01-01"
    )
  )
}
