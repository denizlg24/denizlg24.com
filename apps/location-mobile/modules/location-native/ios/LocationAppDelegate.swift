import ExpoModulesCore

/// iOS relaunches a terminated app for a visit or a significant change and
/// delivers the event only to a location manager that exists at launch, so
/// the tracker starts here rather than when JavaScript first loads the module.
public class LocationAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    LocationTracker.shared.apply()
    return true
  }
}
