import CoreSpotlight
import ExpoModulesCore

/// A Spotlight result is a user activity, not a URL, and React Native's
/// linking only reads web URLs from one. Its identifier is the result's
/// `dashboard://` link: kept here for JavaScript to take as it comes to the
/// foreground, which covers a cold launch where nothing is listening yet.
public class DashboardAppDelegate: ExpoAppDelegateSubscriber {
  static let pendingKey = "dashboard.pendingURL"

  public func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    guard userActivity.activityType == CSSearchableItemActionType,
      let link = userActivity.userInfo?[CSSearchableItemActivityIdentifier] as? String,
      link.hasPrefix("dashboard://")
    else { return false }
    UserDefaults.standard.set(link, forKey: Self.pendingKey)
    restorationHandler(nil)
    return true
  }
}
