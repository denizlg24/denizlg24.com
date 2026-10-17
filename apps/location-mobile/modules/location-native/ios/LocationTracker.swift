import CoreLocation
import MapKit
import UIKit

/// Two jobs: noticing every shop he walks into, always, and recording the
/// trail while he explores.
///
/// Arrivals are what the in-store message reacts to, so three detectors feed
/// them, each covering the others' misses:
/// - `CLVisit`, always on with "Always": cheap and relaunching, but it skips
///   most short stops.
/// - Shop geofences (`ShopFences`) around the shops nearby he buys from. On
///   entry a short GPS probe confirms he stayed near the shop for a minute,
///   so walking past does not count.
/// - Stop detection on the live trail while exploring: ninety seconds within
///   forty metres is a stop wherever it is.
///
/// The trail itself — standard updates, best accuracy, thinned to 20 m / 5 s
/// — is recorded only between switching Explore on and off. A probe's fixes
/// are never recorded. Significant changes run with "Always" to relaunch a
/// terminated app and move the fences along.
public final class LocationTracker: NSObject, CLLocationManagerDelegate {
  public static let shared = LocationTracker()

  private let manager = CLLocationManager()
  private let defaults = UserDefaults.standard
  private let fences = ShopFences()
  private var backgroundSession: CLBackgroundActivitySession?
  private var liveRunning = false
  private var lastLivePoint: CLLocation?
  private(set) var lastLocation: CLLocation?
  private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
  private var lastWidgetReload = Date.distantPast
  private var probe: Probe?
  private var dwell: Dwell?

  private static let liveMinDistance: CLLocationDistance = 20
  private static let liveMinInterval: TimeInterval = 5
  /// Worse than this says nothing about which street was walked.
  private static let maxAccuracy: CLLocationAccuracy = 65
  private static let widgetReloadInterval: TimeInterval = 120

  /// A fence entry counts once he has stayed this close to the shop this long.
  private static let probeNearMetres: CLLocationDistance = 40
  private static let probeStay: TimeInterval = 60
  private static let probeTimeout: TimeInterval = 6 * 60
  /// A stop on the trail: this long within this far of where it began.
  private static let dwellRadius: CLLocationDistance = 40
  private static let dwellStay: TimeInterval = 90

  /// A fence entered and waiting to be confirmed by staying.
  private struct Probe {
    let regionId: String
    let shop: FencedShop
    let deadline: Date
    var nearSince: Date?
  }

  /// Where the trail last stood still, and whether that stop was reported.
  private struct Dwell {
    let anchor: CLLocation
    var reported: Bool
  }

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
    dwell = nil
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
  var fencedShops: Int { fences.shops.count }

  /// iOS asks for "Always" only after "While Using" has been granted.
  func requestPermission() {
    switch manager.authorizationStatus {
    case .notDetermined: manager.requestWhenInUseAuthorization()
    case .authorizedWhenInUse: manager.requestAlwaysAuthorization()
    default: break
    }
  }

  /// Brings the running services in line with the grant, the switch and any probe.
  public func apply() {
    let status = manager.authorizationStatus
    guard status == .authorizedAlways || status == .authorizedWhenInUse else {
      manager.stopMonitoringVisits()
      manager.stopMonitoringSignificantLocationChanges()
      fences.stopAll(manager: manager)
      probe = nil
      stopLive()
      return
    }
    if status == .authorizedAlways {
      manager.startMonitoringVisits()
      manager.startMonitoringSignificantLocationChanges()
      if let location = lastLocation ?? manager.location {
        fences.refreshIfDue(around: location, manager: manager, site: site)
      }
    } else {
      fences.stopAll(manager: manager)
    }
    if let probe, Date() > probe.deadline { self.probe = nil }
    if exploring || probe != nil { startLive() } else { stopLive() }
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
    guard let latest = locations.last else { return }
    if latest.horizontalAccuracy >= 0 {
      lastLocation = latest
      if manager.authorizationStatus == .authorizedAlways {
        fences.refreshIfDue(around: latest, manager: manager, site: site)
      }
    }
    guard liveRunning else { return }

    var snapshot = ExploreStore.read()
    var added = false
    for location in locations {
      guard location.horizontalAccuracy >= 0, location.horizontalAccuracy <= Self.maxAccuracy
      else { continue }
      checkProbe(location)
      guard snapshot.exploring else { continue }
      checkDwell(location)
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
    if let probe, Date() > probe.deadline {
      self.probe = nil
      apply()
    }
    guard added else { return }
    ExploreStore.write(snapshot)
    reloadWidgets()
    flushIfDue()
  }

  public func locationManager(_ manager: CLLocationManager, didVisit visit: CLVisit) {
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
          places: places,
          source: "visit"
        ))
      await MainActor.run { self.flushIfDue() }
    }
  }

  public func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
    guard let shop = fences.shop(for: region) else { return }
    probe = Probe(
      regionId: region.identifier, shop: shop,
      deadline: Date().addingTimeInterval(Self.probeTimeout), nearSince: nil)
    apply()
  }

  public func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
    guard probe?.regionId == region.identifier else { return }
    probe = nil
    apply()
  }

  public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}

  public func locationManager(
    _ manager: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error
  ) {}

  // MARK: - Arrivals

  /// Confirms a fence entry once he has stayed near the shop for a minute;
  /// a fix that is not near starts the minute again.
  private func checkProbe(_ location: CLLocation) {
    guard var current = probe else { return }
    let tolerance = Self.probeNearMetres + min(location.horizontalAccuracy, 30)
    guard location.distance(from: current.shop.location) <= tolerance else {
      current.nearSince = nil
      probe = current
      return
    }
    let since = current.nearSince ?? location.timestamp
    current.nearSince = since
    probe = current
    guard location.timestamp.timeIntervalSince(since) >= Self.probeStay else { return }
    probe = nil
    let shop = current.shop
    let place = QueuedPlace(
      name: shop.name, category: shop.category, latitude: shop.latitude,
      longitude: shop.longitude, distanceMetres: location.distance(from: shop.location).rounded())
    report(
      id: "g-\(Int(since.timeIntervalSince1970))", at: since, location: location,
      source: "geofence", first: place)
    apply()
  }

  /// A stop anywhere on an explored trail.
  private func checkDwell(_ location: CLLocation) {
    guard let current = dwell, location.distance(from: current.anchor) <= Self.dwellRadius else {
      dwell = Dwell(anchor: location, reported: false)
      return
    }
    guard !current.reported,
      location.timestamp.timeIntervalSince(current.anchor.timestamp) >= Self.dwellStay
    else { return }
    dwell?.reported = true
    report(
      id: "s-\(Int(current.anchor.timestamp.timeIntervalSince1970))",
      at: current.anchor.timestamp, location: current.anchor, source: "stop", first: nil)
  }

  private func report(
    id: String, at arrived: Date, location: CLLocation, source: String, first: QueuedPlace?
  ) {
    Task {
      var places = await Self.nearbyPlaces(location.coordinate)
      if let first {
        places.removeAll { $0.name == first.name }
        places = Array(([first] + places).prefix(Self.placeLimit))
      }
      await LocationQueue.shared.add(
        visit: QueuedVisit(
          id: id, arrivedAt: Self.iso(arrived), departedAt: nil,
          latitude: location.coordinate.latitude, longitude: location.coordinate.longitude,
          horizontalAccuracy: max(0, location.horizontalAccuracy), places: places,
          source: source))
      await MainActor.run { self.flushIfDue() }
    }
  }

  // MARK: - Places

  private static let placeRadius: CLLocationDistance = 150
  private static let placeLimit = 10
  private static let placeTimeout: UInt64 = 8_000_000_000

  /// Apple Maps' points of interest around a coordinate, nearest first. Runs
  /// on the phone with no key and no quota; a slow or failed search yields
  /// none rather than holding the arrival back.
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
    let eager = exploring
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
