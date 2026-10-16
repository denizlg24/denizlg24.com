import CoreLocation
import MapKit
import UIKit

/// When the GPS trail runs. `auto` runs it between leaving a visit and
/// arriving at the next one, which is when a trail says anything.
enum LiveMode: String {
  case off, auto, on
}

/// The three CoreLocation services and the queue they feed.
///
/// Visits and significant changes are always on once "Always" is granted:
/// both cost next to nothing and relaunch a terminated app, which is what
/// makes the history continuous. Standard updates (the live trail) run only
/// as `liveMode` says. Everything is recorded natively, because a relaunch
/// for a location event starts no JavaScript.
final class LocationTracker: NSObject, CLLocationManagerDelegate {
  static let shared = LocationTracker()

  private let manager = CLLocationManager()
  private let defaults = UserDefaults.standard
  /// Keeps standard updates alive in the background (iOS 17+).
  private var backgroundSession: CLBackgroundActivitySession?
  private var liveRunning = false
  private var lastLivePoint: CLLocation?
  private(set) var lastLocation: CLLocation?
  private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

  /// A live point closer than this to the last one, and sooner than
  /// `liveMinInterval`, adds nothing to the trail.
  private static let liveMinDistance: CLLocationDistance = 20
  private static let liveMinInterval: TimeInterval = 5
  private static let maxAccuracy: CLLocationAccuracy = 2_000

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

  var liveMode: LiveMode {
    get { LiveMode(rawValue: defaults.string(forKey: "liveMode") ?? "") ?? .auto }
    set {
      defaults.set(newValue.rawValue, forKey: "liveMode")
      apply()
    }
  }

  /// Persisted so a relaunch mid-journey keeps the trail running.
  private var moving: Bool {
    get { defaults.bool(forKey: "moving") }
    set { defaults.set(newValue, forKey: "moving") }
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

  /// Brings the running services in line with the grant and the mode.
  func apply() {
    let status = manager.authorizationStatus
    guard status == .authorizedAlways || status == .authorizedWhenInUse else {
      manager.stopMonitoringVisits()
      manager.stopMonitoringSignificantLocationChanges()
      stopLive()
      return
    }
    if status == .authorizedAlways {
      manager.startMonitoringVisits()
      manager.startMonitoringSignificantLocationChanges()
    }
    let wantLive = liveMode == .on || (liveMode == .auto && moving)
    if wantLive { startLive() } else { stopLive() }
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

  // MARK: - Delegate

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    apply()
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    for location in locations {
      guard location.horizontalAccuracy >= 0, location.horizontalAccuracy <= Self.maxAccuracy
      else { continue }
      lastLocation = location
      if liveRunning {
        if let previous = lastLivePoint,
          location.distance(from: previous) < Self.liveMinDistance,
          location.timestamp.timeIntervalSince(previous.timestamp) < Self.liveMinInterval
        {
          continue
        }
        lastLivePoint = location
      } else if liveMode == .auto, location.speed > 3 {
        // A coarse fix taken at speed: on the move before any visit said so.
        moving = true
        apply()
      }
      record(point: location, source: liveRunning ? "live" : "significant")
    }
    flushIfDue()
  }

  func locationManager(_ manager: CLLocationManager, didVisit visit: CLVisit) {
    // A visit whose start CoreLocation did not see has nothing to key on.
    guard visit.arrivalDate != .distantPast else { return }
    let departed = visit.departureDate == .distantFuture ? nil : visit.departureDate
    Task {
      // Only an arrival is looked up: the server judges the shop on arrival,
      // and the departure report keeps what the arrival already sent.
      let places = departed == nil ? await Self.nearbyPlaces(visit.coordinate) : []
      await LocationQueue.shared.add(
        visit: QueuedVisit(
          id: "v-\(Int(visit.arrivalDate.timeIntervalSince1970))",
          arrivedAt: Self.iso(visit.arrivalDate),
          departedAt: departed.map(Self.iso),
          latitude: visit.coordinate.latitude,
          longitude: visit.coordinate.longitude,
          horizontalAccuracy: max(0, visit.horizontalAccuracy),
          places: places
        ))
      await MainActor.run { self.flushIfDue() }
    }
    if liveMode == .auto {
      moving = departed != nil
      apply()
    }
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}

  // MARK: - Places

  private static let placeRadius: CLLocationDistance = 150
  private static let placeLimit = 5
  private static let placeTimeout: UInt64 = 8_000_000_000

  /// Apple Maps' points of interest around a coordinate, nearest first. Runs
  /// on the phone with no key and no quota; a slow or failed search yields
  /// none rather than holding the visit back.
  static func nearbyPlaces(_ coordinate: CLLocationCoordinate2D) async -> [QueuedPlace] {
    let origin = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
    let request = MKLocalPointsOfInterestRequest(center: coordinate, radius: placeRadius)
    let search = MKLocalSearch(request: request)
    let items: [MKMapItem] = await withTaskGroup(of: [MKMapItem]?.self) { group in
      group.addTask { (try? await search.start())?.mapItems ?? [] }
      group.addTask {
        try? await Task.sleep(nanoseconds: placeTimeout)
        return nil
      }
      let first = await group.next() ?? nil
      group.cancelAll()
      if first == nil { search.cancel() }
      return first ?? []
    }
    return items
      .compactMap { item -> QueuedPlace? in
        guard let name = item.name, !name.isEmpty else { return nil }
        let point = item.placemark.coordinate
        let distance = origin.distance(
          from: CLLocation(latitude: point.latitude, longitude: point.longitude))
        return QueuedPlace(
          name: name,
          category: item.pointOfInterestCategory?.rawValue,
          latitude: point.latitude,
          longitude: point.longitude,
          distanceMetres: distance.rounded()
        )
      }
      .sorted { $0.distanceMetres < $1.distanceMetres }
      .prefix(placeLimit)
      .map { $0 }
  }

  // MARK: - Recording

  private func record(point location: CLLocation, source: String) {
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
      source: source
    )
    Task { await LocationQueue.shared.add(point: point) }
  }

  /// Uploads inside a background task, so a relaunch for one event has the
  /// seconds it needs to send it before iOS suspends the app again.
  func flushIfDue(force: Bool = false) {
    Task { @MainActor in
      let due = await LocationQueue.shared.due
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
