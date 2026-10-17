import CoreLocation
import Foundation
import WidgetKit

/// The exploration the app and its widgets share through the App Group: on or
/// off, since when, how far, and the trail drawn on the map widget. The app
/// writes it; the extension only reads it.
public struct ExploreSnapshot: Codable, Equatable {
  public var exploring: Bool
  public var startedAt: Date?
  public var endedAt: Date?
  public var distanceMetres: Double
  /// The latest session's trail as `[latitude, longitude]`, thinned to stay small.
  public var trail: [[Double]]

  public static let empty = ExploreSnapshot(
    exploring: false, startedAt: nil, endedAt: nil, distanceMetres: 0, trail: [])

  public var coordinates: [CLLocationCoordinate2D] {
    trail.compactMap { pair in
      guard pair.count == 2 else { return nil }
      return CLLocationCoordinate2D(latitude: pair[0], longitude: pair[1])
    }
  }

  public var last: CLLocationCoordinate2D? { coordinates.last }
}

public enum ExploreStore {
  public static let widgetKinds = ["LocationExplore", "LocationMap"]

  /// Above this the trail is halved, keeping the newest stretch at full detail.
  private static let maxTrailPoints = 2_400
  private static let keepRecent = 400

  public static var appGroup: String? {
    Bundle.main.object(forInfoDictionaryKey: "LocationAppGroup") as? String
  }

  private static var fileURL: URL? {
    guard let appGroup else { return nil }
    return FileManager.default
      .containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
      .appendingPathComponent("explore.json")
  }

  public static func read() -> ExploreSnapshot {
    guard let fileURL, let data = try? Data(contentsOf: fileURL),
      let snapshot = try? JSONDecoder().decode(ExploreSnapshot.self, from: data)
    else { return .empty }
    return snapshot
  }

  public static func write(_ snapshot: ExploreSnapshot) {
    guard let fileURL, let data = try? JSONEncoder().encode(snapshot) else { return }
    try? data.write(
      to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
  }

  /// Appends a fix to the session, adding the step to the distance.
  public static func append(_ location: CLLocation, to snapshot: inout ExploreSnapshot) {
    if let last = snapshot.last {
      let previous = CLLocation(latitude: last.latitude, longitude: last.longitude)
      snapshot.distanceMetres += location.distance(from: previous)
    }
    snapshot.trail.append([location.coordinate.latitude, location.coordinate.longitude])
    if snapshot.trail.count > maxTrailPoints {
      let cut = snapshot.trail.count - keepRecent
      let older = snapshot.trail[..<cut].enumerated().filter { $0.offset % 2 == 0 }.map(\.element)
      snapshot.trail = older + snapshot.trail[cut...]
    }
  }

  public static func reloadWidgets() {
    for kind in widgetKinds { WidgetCenter.shared.reloadTimelines(ofKind: kind) }
  }
}

public enum ExploreFormat {
  /// "850 m", "3.4 km".
  public static func distance(_ metres: Double) -> String {
    metres < 1_000 ? "\(Int(metres.rounded())) m" : String(format: "%.1f km", metres / 1_000)
  }
}
