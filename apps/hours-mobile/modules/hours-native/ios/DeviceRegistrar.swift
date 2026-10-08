import ActivityKit
import Foundation
import UIKit

/// Tells the server how to reach this phone's Live Activities: the
/// push-to-start token, and each running activity's update token. Sent whole
/// whenever any of them changes, so a missing activity reads as ended.
actor DeviceRegistrar {
  static let shared = DeviceRegistrar()

  private var observing = false
  private var startToken: String?
  private var activityTokens: [String: String] = [:]
  private var watched: Set<String> = []
  private var lastSent: [String: AnyHashable]?

  private static func hex(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
  }

  func start() {
    guard !observing else { return }
    observing = true
    Task {
      for await data in Activity<ShiftAttributes>.pushToStartTokenUpdates {
        await self.setStartToken(Self.hex(data))
      }
    }
    Task {
      for await activity in Activity<ShiftAttributes>.activityUpdates {
        await self.watch(activity)
        // A push-to-start can race the phone's own start; settle on one.
        let snapshot = await HoursSync.current(maxAge: 0)
        await ShiftActivities.sync(snapshot)
      }
    }
    for activity in Activity<ShiftAttributes>.activities {
      watch(activity)
    }
  }

  private func watch(_ activity: Activity<ShiftAttributes>) {
    guard !watched.contains(activity.id) else { return }
    watched.insert(activity.id)
    let id = activity.id
    Task {
      for await data in activity.pushTokenUpdates {
        await self.setActivityToken(id, Self.hex(data))
      }
    }
    Task {
      for await state in activity.activityStateUpdates where state == .ended || state == .dismissed {
        await self.removeActivity(id)
      }
    }
  }

  private func setStartToken(_ token: String) async {
    startToken = token
    await send()
  }

  private func setActivityToken(_ id: String, _ token: String) async {
    activityTokens[id] = token
    await send()
  }

  private func removeActivity(_ id: String) async {
    activityTokens[id] = nil
    watched.remove(id)
    await send()
  }

  func send() async {
    guard SessionKeychain.read() != nil else { return }
    let environment =
      Bundle.main.object(forInfoDictionaryKey: "HoursApsEnvironment") as? String ?? "development"
    let name = await MainActor.run { UIDevice.current.name }
    let activities = activityTokens.sorted { $0.key < $1.key }.map {
      ["activityId": $0.key, "token": $0.value]
    }
    let body: [String: AnyHashable] = [
      "app": "hours",
      "environment": environment,
      "name": String(name.prefix(80)),
      "liveActivityStartToken": startToken.map { AnyHashable($0) } ?? AnyHashable(NSNull()),
      "liveActivities": activities,
    ]
    guard body != lastSent else { return }
    do {
      _ = try await HoursAPI.request(
        "mobile/devices/\(HoursShared.installationId)", method: "PUT", body: body)
      lastSent = body
    } catch {
      // The next token change, launch or sign-in sends it again.
    }
  }

  func forget() async {
    lastSent = nil
    _ = try? await HoursAPI.request(
      "mobile/devices/\(HoursShared.installationId)", method: "DELETE")
  }
}
