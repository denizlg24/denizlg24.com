import ActivityKit
import ExpoModulesCore
import UIKit
import WidgetKit

public class VoiceNativeModule: Module {
  private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
  private var stopObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("VoiceNative")

    Events("onStop")

    OnStartObserving {
      self.stopObserver = NotificationCenter.default.addObserver(
        forName: Notification.Name("VoiceStopRequested"), object: nil, queue: .main
      ) { [weak self] _ in
        self?.sendEvent("onStop", [:])
      }
    }

    OnStopObserving {
      if let observer = self.stopObserver {
        NotificationCenter.default.removeObserver(observer)
      }
      self.stopObserver = nil
    }

    /// Starts the turn's activity, or moves the running one on.
    AsyncFunction("updateActivity") { (phase: String, text: String, startedAt: Double) in
      let state = VoiceAttributes.ContentState(
        phase: phase, text: String(text.suffix(240)), startedAt: startedAt)
      let current = Activity<VoiceAttributes>.activities.first {
        $0.activityState == .active || $0.activityState == .stale
      }
      if let current {
        await current.update(ActivityContent(state: state, staleDate: nil))
        return
      }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
      _ = try? Activity.request(
        attributes: VoiceAttributes(),
        content: ActivityContent(state: state, staleDate: nil),
        pushType: nil)
    }

    /// Leaves the final state up briefly, then clears it.
    AsyncFunction("endActivity") { (phase: String, text: String, startedAt: Double) in
      let state = VoiceAttributes.ContentState(
        phase: phase, text: String(text.suffix(240)), startedAt: startedAt)
      for activity in Activity<VoiceAttributes>.activities {
        await activity.end(
          ActivityContent(state: state, staleDate: nil),
          dismissalPolicy: .after(Date().addingTimeInterval(60)))
      }
    }

    Function("saveExchange") { (question: String, reply: String) in
      VoiceExchange.save(
        VoiceExchange(question: question, reply: reply, at: Date().timeIntervalSince1970))
      WidgetCenter.shared.reloadAllTimelines()
    }

    Function("clearExchange") {
      VoiceExchange.save(nil)
      WidgetCenter.shared.reloadAllTimelines()
    }

    /// Keeps a turn's request alive for the few minutes iOS allows after the
    /// microphone stops and before the reply starts playing.
    Function("beginBackgroundTask") {
      DispatchQueue.main.async {
        guard self.backgroundTask == .invalid else { return }
        self.backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "voice-turn") {
          UIApplication.shared.endBackgroundTask(self.backgroundTask)
          self.backgroundTask = .invalid
        }
      }
    }

    Function("endBackgroundTask") {
      DispatchQueue.main.async {
        guard self.backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(self.backgroundTask)
        self.backgroundTask = .invalid
      }
    }
  }
}
