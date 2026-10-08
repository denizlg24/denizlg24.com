import ActivityKit
import ExpoModulesCore
import WidgetKit

public class HoursNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HoursNative")

    /// The session JSON `@repo/native-auth` persists, kept in the App Group's
    /// keychain so widgets and intents can call the API too.
    Function("getSession") { () -> String? in
      SessionKeychain.readRaw()
    }

    Function("setSession") { (json: String?) in
      SessionKeychain.writeRaw(json)
    }

    Function("installationId") { () -> String in
      HoursShared.installationId
    }

    /// Reminder preferences, a small JSON blob in the App Group.
    Function("getSettings") { () -> String? in
      HoursShared.defaults?.string(forKey: "settings")
    }

    Function("setSettings") { (json: String) in
      HoursShared.defaults?.set(json, forKey: "settings")
    }

    Function("activitiesEnabled") { () -> Bool in
      ActivityAuthorizationInfo().areActivitiesEnabled
    }

    /// A fresh `/hours` payload: kept for every process, and the Live
    /// Activity, widgets and controls brought in line with it.
    AsyncFunction("setOverview") { (json: String) in
      guard let data = json.data(using: .utf8),
        let overview = try? JSONDecoder().decode(Overview.self, from: data)
      else { return }
      let now = Date()
      OverviewStore.save(data, at: now)
      await HoursSync.apply(overview.snapshot(at: now))
    }

    /// Signed out: nothing on the Lock Screen or Home Screen stays behind.
    AsyncFunction("clear") {
      OverviewStore.clear()
      await HoursSync.apply(.signedOut)
    }

    /// Before signing out, while the session can still call the API.
    AsyncFunction("forgetDevice") {
      await DeviceRegistrar.shared.forget()
    }

    AsyncFunction("registerDevice") {
      await DeviceRegistrar.shared.start()
      await DeviceRegistrar.shared.send()
    }
  }
}
