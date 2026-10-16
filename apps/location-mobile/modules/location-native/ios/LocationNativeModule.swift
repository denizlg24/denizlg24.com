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

    AsyncFunction("setLiveMode") { (mode: String) in
      LocationTracker.shared.liveMode = LiveMode(rawValue: mode) ?? .auto
    }.runOnQueue(.main)

    AsyncFunction("flush") {
      LocationTracker.shared.flushIfDue(force: true)
    }.runOnQueue(.main)

    AsyncFunction("status") { () -> [String: Any] in
      let tracker = LocationTracker.shared
      let upload = await LocationQueue.shared.status()
      let last = tracker.lastLocation
      return [
        "authorization": tracker.authorization,
        "precise": tracker.preciseLocation,
        "liveMode": tracker.liveMode.rawValue,
        "liveActive": tracker.liveActive,
        "pendingPoints": upload.pendingPoints,
        "pendingVisits": upload.pendingVisits,
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
  }
}
