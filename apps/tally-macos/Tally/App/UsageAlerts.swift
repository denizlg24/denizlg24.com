import Foundation
@preconcurrency import UserNotifications

/// Notifies once per window when the active seat crosses the threshold, with
/// an action that switches to the seat with the most headroom.
@MainActor
final class UsageAlerts: NSObject, UNUserNotificationCenterDelegate {
    private nonisolated static let category = "seat-limit"
    private nonisolated static let switchAction = "switch-best"

    private var notified: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: "alerts.notified") ?? []) }
        set { UserDefaults.standard.set(Array(newValue.suffix(50)), forKey: "alerts.notified") }
    }

    var threshold: Double {
        let stored = UserDefaults.standard.double(forKey: "alertThreshold")
        return stored > 0 ? stored : 90
    }

    func start() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        let action = UNNotificationAction(identifier: Self.switchAction, title: "Switch seat")
        center.setNotificationCategories([
            UNNotificationCategory(identifier: Self.category, actions: [action], intentIdentifiers: []),
        ])
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    func evaluate(model: AppModel) {
        guard let seat = model.claude.activeSeat, let usage = seat.usage else { return }
        let windows: [(String, UsageWindow?)] = [("5h", usage.session), ("7d", usage.week)]
        for (label, window) in windows {
            guard let window, window.effectivePercent() >= threshold else { continue }
            let key = "\(seat.id)|\(label)|\(Int(window.resetsAt?.timeIntervalSince1970 ?? 0))"
            guard !notified.contains(key) else { continue }
            notified.insert(key)

            let content = UNMutableNotificationContent()
            content.title = "\(seat.title) · \(label) at \(Format.percent(window.effectivePercent()))"
            if let best = model.claude.bestAlternative, let headroom = best.usage?.headroom {
                content.body = "\(best.title) has \(Format.percent(headroom)) left"
                content.categoryIdentifier = Self.category
            } else if let resetsAt = window.resetsAt {
                content.body = "Resets \(Format.countdown(to: resetsAt))"
            }
            UNUserNotificationCenter.current().add(
                UNNotificationRequest(identifier: key, content: content, trigger: nil)
            )
        }
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        guard response.actionIdentifier == Self.switchAction else { return }
        await AppModel.shared.switchToBestSeat()
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}
