import CoreLocation
import UIKit

/// Records only while exploring: switched on when setting off, off on arrival.
///
/// Exploring runs standard updates (best accuracy, 10 m filter, thinned to
/// 20 m / 5 s) with background updates, the blue indicator and a
/// `CLBackgroundActivitySession`, and uploads every few seconds. Significant
/// changes run alongside only so that iOS relaunches a terminated app
/// mid-walk; the relaunch restarts the trail here, before any JavaScript.
/// Off, nothing is monitored at all.
public final class LocationTracker: NSObject, CLLocationManagerDelegate {
  public static let shared = LocationTracker()

  private let manager = CLLocationManager()
  private let defaults = UserDefaults.standard
  private var backgroundSession: CLBackgroundActivitySession?
  private var liveRunning = false
  private var lastLivePoint: CLLocation?
  private(set) var lastLocation: CLLocation?
  private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
  private var lastWidgetReload = Date.distantPast

  private static let liveMinDistance: CLLocationDistance = 20
  private static let liveMinInterval: TimeInterval = 5
  /// Worse than this says nothing about which street was walked.
  private static let maxAccuracy: CLLocationAccuracy = 65
  private static let widgetReloadInterval: TimeInterval = 120

  private override init() {
    super.init()
    manager.delegate = self
    manager.activityType = .other
    manager.desiredAccuracy = kCLLocationAccuracyBest
    manager.distanceFilter = 10
    manager.pausesLocationUpdatesAutomatically = false
  }

  var installationId: String {
    if let existing = defaults.string(forKey: "installationId") { return existing }
    let fresh = UUID().uuidString.lowercased()
    defaults.set(fresh, forKey: "installationId")
    return fresh
  }

  var site: URL {
    let raw = Bundle.main.object(forInfoDictionaryKey: "LocationSite") as? String
    return URL(string: raw ?? "https://denizlg24.com")!
  }

  public var exploring: Bool { ExploreStore.read().exploring }

  /// Starting clears the previous session's trail; stopping keeps it for the
  /// map widget and sends whatever is queued.
  public func setExploring(_ on: Bool) {
    var snapshot = ExploreStore.read()
    guard snapshot.exploring != on else {
      apply()
      return
    }
    if on {
      snapshot = ExploreSnapshot(
        exploring: true, startedAt: Date(), endedAt: nil, distanceMetres: 0, trail: [])
      lastLivePoint = nil
    } else {
      snapshot.exploring = false
      snapshot.endedAt = Date()
    }
    ExploreStore.write(snapshot)
    apply()
    if !on { flushIfDue(force: true) }
    reloadWidgets(force: true)
  }

  var authorization: String {
    switch manager.authorizationStatus {
    case .authorizedAlways: return "always"
    case .authorizedWhenInUse: return "whenInUse"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unknown"
    }
  }

  var preciseLocation: Bool { manager.accuracyAuthorization == .fullAccuracy }
  var liveActive: Bool { liveRunning }

  /// iOS asks for "Always" only after "While Using" has been granted.
  func requestPermission() {
    switch manager.authorizationStatus {
    case .notDetermined: manager.requestWhenInUseAuthorization()
    case .authorizedWhenInUse: manager.requestAlwaysAuthorization()
    default: break
    }
  }

  /// Brings the running services in line with the grant and the switch.
  public func apply() {
    // Builds before Explore monitored visits around the clock; a monitor
    // outlives the app that started it.
    manager.stopMonitoringVisits()
    let status = manager.authorizationStatus
    let granted = status == .authorizedAlways || status == .authorizedWhenInUse
    guard granted, exploring else {
      manager.stopMonitoringSignificantLocationChanges()
      stopLive()
      return
    }
    if status == .authorizedAlways { manager.startMonitoringSignificantLocationChanges() }
    startLive()
  }

  private func startLive() {
    guard !liveRunning else { return }
    liveRunning = true
    backgroundSession = CLBackgroundActivitySession()
    manager.allowsBackgroundLocationUpdates = true
    manager.showsBackgroundLocationIndicator = true
    manager.startUpdatingLocation()
  }

  private func stopLive() {
    guard liveRunning else { return }
    liveRunning = false
    manager.stopUpdatingLocation()
    manager.allowsBackgroundLocationUpdates = false
    backgroundSession?.invalidate()
    backgroundSession = nil
  }

  private func reloadWidgets(force: Bool = false) {
    guard force || Date().timeIntervalSince(lastWidgetReload) >= Self.widgetReloadInterval
    else { return }
    lastWidgetReload = Date()
    ExploreStore.reloadWidgets()
  }

  // MARK: - Delegate

  public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    apply()
  }

  public func locationManager(
    _ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]
  ) {
    guard liveRunning else { return }
    var snapshot = ExploreStore.read()
    var added = false
    for location in locations {
      guard location.horizontalAccuracy >= 0, location.horizontalAccuracy <= Self.maxAccuracy
      else { continue }
      lastLocation = location
      if let previous = lastLivePoint,
        location.distance(from: previous) < Self.liveMinDistance,
        location.timestamp.timeIntervalSince(previous.timestamp) < Self.liveMinInterval
      {
        continue
      }
      lastLivePoint = location
      ExploreStore.append(location, to: &snapshot)
      record(point: location)
      added = true
    }
    guard added else { return }
    ExploreStore.write(snapshot)
    reloadWidgets()
    flushIfDue()
  }

  public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}

  // MARK: - Recording

  private func record(point location: CLLocation) {
    let point = QueuedPoint(
      id: UUID().uuidString.lowercased(),
      recordedAt: Self.iso(location.timestamp),
      latitude: location.coordinate.latitude,
      longitude: location.coordinate.longitude,
      horizontalAccuracy: location.horizontalAccuracy,
      altitude: location.verticalAccuracy >= 0 ? location.altitude : nil,
      verticalAccuracy: location.verticalAccuracy >= 0 ? location.verticalAccuracy : nil,
      speed: location.speed >= 0 ? location.speed : nil,
      course: location.course >= 0 && location.course <= 360 ? location.course : nil,
      source: "live"
    )
    Task { await LocationQueue.shared.add(point: point) }
  }

  /// Uploads inside a background task, so a relaunch for one event has the
  /// seconds it needs to send it before iOS suspends the app again.
  func flushIfDue(force: Bool = false) {
    let eager = liveRunning
    Task { @MainActor in
      let due = await LocationQueue.shared.isDue(eager: eager)
      guard force || due else { return }
      guard self.backgroundTask == .invalid else { return }
      self.backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "location-upload") {
        self.endBackgroundTask()
      }
      await LocationQueue.shared.flush(installationId: self.installationId, site: self.site)
      self.endBackgroundTask()
    }
  }

  @MainActor
  private func endBackgroundTask() {
    guard backgroundTask != .invalid else { return }
    UIApplication.shared.endBackgroundTask(backgroundTask)
    backgroundTask = .invalid
  }

  private static let formatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()

  static func iso(_ date: Date) -> String { formatter.string(from: date) }
}
