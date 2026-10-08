import SwiftUI
import WidgetKit

struct HoursEntry: TimelineEntry {
  let date: Date
  let snapshot: HoursSnapshot
}

/// The stored overview, refetched when it is over five minutes old. Running
/// figures are `Text` timers, so a working shift needs no extra entries; the
/// next reload is what catches a change made somewhere else.
struct HoursProvider: TimelineProvider {
  func placeholder(in context: Context) -> HoursEntry {
    HoursEntry(date: Date(), snapshot: .preview)
  }

  func getSnapshot(in context: Context, completion: @escaping (HoursEntry) -> Void) {
    if context.isPreview {
      completion(HoursEntry(date: Date(), snapshot: .preview))
      return
    }
    Task {
      completion(HoursEntry(date: Date(), snapshot: await HoursSync.current(maxAge: 5 * 60)))
    }
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<HoursEntry>) -> Void) {
    Task {
      let snapshot = await HoursSync.current(maxAge: 5 * 60)
      let now = Date()
      // Midnight turns today's figure over even when nothing else changes.
      let midnight = Calendar.current.startOfDay(for: now).addingTimeInterval(24 * 60 * 60)
      let next = min(now.addingTimeInterval(snapshot.status == .off ? 30 * 60 : 15 * 60), midnight)
      completion(Timeline(entries: [HoursEntry(date: now, snapshot: snapshot)], policy: .after(next)))
    }
  }
}

extension HoursSnapshot {
  static let preview: HoursSnapshot = {
    let now = Date()
    var snapshot = HoursSnapshot.signedOut
    snapshot.fetchedAt = now
    snapshot.status = .working
    snapshot.sessionId = "preview"
    snapshot.jobName = "Pandora"
    snapshot.shiftStart = now.addingTimeInterval(-9_000)
    snapshot.workedFrom = now.addingTimeInterval(-8_100)
    snapshot.workedSeconds = 8_100
    snapshot.todayBaseMinutes = 0
    snapshot.weekBaseMinutes = 1_320
    snapshot.monthBaseMinutes = 4_200
    snapshot.weeklyTargetMinutes = 1_920
    snapshot.hasJobs = true
    return snapshot
  }()
}
