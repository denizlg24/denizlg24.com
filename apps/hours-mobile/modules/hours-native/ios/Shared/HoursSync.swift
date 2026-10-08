import Foundation
import WidgetKit

#if !HOURS_WIDGET_EXTENSION
  import ActivityKit
#endif

/// After anything changes the shift: every widget and control redraws from
/// the stored overview, and — in the app's process, the only one ActivityKit
/// lets change an activity — the Live Activity follows.
public enum HoursSync {
  public static func reloadSurfaces() {
    WidgetCenter.shared.reloadAllTimelines()
    ControlCenter.shared.reloadAllControls()
  }

  public static func apply(_ snapshot: HoursSnapshot) async {
    #if !HOURS_WIDGET_EXTENSION
      await ShiftActivities.sync(snapshot)
    #endif
    reloadSurfaces()
  }

  /// Clock, re-read the overview, redraw. What every intent does.
  @discardableResult
  public static func perform(_ action: ClockAction, jobId: String? = nil) async throws
    -> HoursSnapshot
  {
    try await HoursAPI.clock(action, jobId: jobId)
    let snapshot = try await HoursAPI.refreshOverview()
    await apply(snapshot)
    return snapshot
  }

  /// The overview, fetched if what is stored is older than `maxAge`.
  public static func current(maxAge: TimeInterval) async -> HoursSnapshot {
    if let stored = OverviewStore.snapshot(),
      Date().timeIntervalSince(stored.fetchedAt) < maxAge
    {
      return stored
    }
    if let fresh = try? await HoursAPI.refreshOverview() { return fresh }
    return OverviewStore.snapshot() ?? .signedOut
  }
}

#if !HOURS_WIDGET_EXTENSION
  @MainActor
  public enum ShiftActivities {
    /// One activity for the open shift and none otherwise. A push-to-start
    /// that raced the phone's own start leaves two; the newest survives.
    public static func sync(_ snapshot: HoursSnapshot) async {
      let activities = Activity<ShiftAttributes>.activities
      guard let state = snapshot.activityState, let jobName = snapshot.jobName else {
        for activity in activities where activity.activityState == .active {
          var final = activity.content.state
          final.status = "ended"
          final.breakFrom = nil
          await activity.end(
            ActivityContent(state: final, staleDate: nil),
            dismissalPolicy: .after(Date().addingTimeInterval(15 * 60)))
        }
        return
      }
      let live = activities.filter { $0.activityState == .active || $0.activityState == .stale }
      let keep =
        live.first { $0.content.state.sessionId == state.sessionId } ?? live.first
      for activity in live where activity.id != keep?.id {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
      if let keep {
        if keep.content.state != state || keep.attributes.jobName != jobName {
          await keep.update(ActivityContent(state: state, staleDate: nil))
        }
        return
      }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
      _ = try? Activity.request(
        attributes: ShiftAttributes(jobName: jobName),
        content: ActivityContent(state: state, staleDate: nil),
        pushType: .token)
    }
  }
#endif
