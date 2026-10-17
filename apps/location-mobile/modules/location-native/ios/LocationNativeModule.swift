import ExpoModulesCore

public class LocationNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LocationNative")

    /// The session JSON `@repo/native-auth` persists, in the keychain the
    /// uploader reads when no JavaScript is running.
    Function("getSession") { () -> String? in
      SessionKeychain.readRaw()
    }

    Function("setSession") { (json: String?) in
      SessionKeychain.writeRaw(json)
    }

    Function("installationId") { () -> String in
      LocationTracker.shared.installationId
    }

    AsyncFunction("requestPermission") {
      LocationTracker.shared.requestPermission()
    }.runOnQueue(.main)

    AsyncFunction("setExploring") { (on: Bool) in
      LocationTracker.shared.setExploring(on)
    }.runOnQueue(.main)

    /// The session's trail, flat `[lon, lat, …]` like the server's tracks.
    Function("sessionTrail") { () -> [Double] in
      ExploreStore.read().trail.flatMap { pair in pair.count == 2 ? [pair[1], pair[0]] : [] }
    }

    AsyncFunction("flush") {
      LocationTracker.shared.flushIfDue(force: true)
    }.runOnQueue(.main)

    AsyncFunction("status") { () -> [String: Any] in
      let tracker = LocationTracker.shared
      let upload = await LocationQueue.shared.status()
      let last = tracker.lastLocation
      let explore = ExploreStore.read()
      return [
        "authorization": tracker.authorization,
        "precise": tracker.preciseLocation,
        "exploring": explore.exploring,
        "liveActive": tracker.liveActive,
        "startedAt": explore.startedAt.map { LocationTracker.iso($0) as Any } ?? NSNull(),
        "endedAt": explore.endedAt.map { LocationTracker.iso($0) as Any } ?? NSNull(),
        "distanceMetres": explore.distanceMetres,
        "sessionPoints": explore.trail.count,
        "pendingPoints": upload.pendingPoints,
        "lastUploadAt": upload.lastUploadAt.map { LocationTracker.iso($0) as Any } ?? NSNull(),
        "lastError": upload.lastError.map { $0 as Any } ?? NSNull(),
        "lastFix": last.map { location in
          [
            "latitude": location.coordinate.latitude,
            "longitude": location.coordinate.longitude,
            "horizontalAccuracy": location.horizontalAccuracy,
            "recordedAt": LocationTracker.iso(location.timestamp),
          ] as Any
        } ?? NSNull(),
      ]
    }

    View(ExploredMapView.self) {
      Prop("tracks") { (view: ExploredMapView, tracks: [[Double]]) in view.tracks = tracks }
      Prop("spots") { (view: ExploredMapView, spots: [[Double]]) in view.spots = spots }
      Prop("session") { (view: ExploredMapView, session: [Double]) in view.sessionTrail = session }
      Prop("radiusMetres") { (view: ExploredMapView, radius: Double) in view.radiusMetres = radius }
      Prop("frameMode") { (view: ExploredMapView, mode: String) in view.frameMode = mode }
      Prop("frameKey") { (view: ExploredMapView, key: Int) in view.frameKey = key }
      OnViewDidUpdateProps { (view: ExploredMapView) in view.update() }
    }
  }
}
