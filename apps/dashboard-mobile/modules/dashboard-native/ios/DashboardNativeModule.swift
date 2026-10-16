import ExpoModulesCore
import WidgetKit

public class DashboardNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DashboardNative")

    /// The session JSON `@repo/native-auth` persists, kept in the App Group's
    /// keychain so widgets, intents and the Share extension call the API too.
    Function("getSession") { () -> String? in
      SessionKeychain.readRaw()
    }

    Function("setSession") { (json: String?) in
      SessionKeychain.writeRaw(json)
    }

    Function("installationId") { () -> String in
      DashboardShared.installationId
    }

    /// Notification toggles and lead times, a small JSON blob in the App Group.
    Function("getSettings") { () -> String? in
      DashboardShared.defaults?.string(forKey: "settings")
    }

    Function("setSettings") { (json: String) in
      DashboardShared.defaults?.set(json, forKey: "settings")
    }

    Function("setToday") { (json: String) in
      guard let data = json.data(using: .utf8) else { return }
      SnapshotStore.save(.today, data)
      SnapshotStore.reloadWidgets()
    }

    Function("setWatchlist") { (json: String) in
      guard let data = json.data(using: .utf8) else { return }
      SnapshotStore.save(.watchlist, data)
      SnapshotStore.reloadWidgets()
    }

    AsyncFunction("indexSpotlight") { (domain: String, itemsJson: String) in
      try await Spotlight.replace(domain: domain, json: itemsJson)
    }

    /// Signed out: nothing on the Home Screen or in Spotlight stays behind.
    AsyncFunction("clear") {
      SnapshotStore.clear()
      SnapshotStore.reloadWidgets()
      await Spotlight.clear()
    }
  }
}
