import ExpoModulesCore
import WidgetKit

/// Must match `SNAPSHOT_KEY` in widgets/ios/Snapshot.swift.
private let snapshotKey = "snapshot"

/// The App Group's defaults, or nil in a build without the group: the
/// Info.plist names it only in the ad-hoc build, and the container exists
/// only when the signature grants it.
private func sharedDefaults() -> UserDefaults? {
  guard
    let group = Bundle.main.object(forInfoDictionaryKey: "MacrosAppGroup") as? String,
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) != nil
  else { return nil }
  return UserDefaults(suiteName: group)
}

public class MacrosWidgetsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MacrosWidgets")

    Function("isAvailable") { () -> Bool in
      sharedDefaults() != nil
    }

    Function("setSnapshot") { (json: String) in
      guard let defaults = sharedDefaults() else { return }
      defaults.set(json, forKey: snapshotKey)
      WidgetCenter.shared.reloadAllTimelines()
    }

    Function("clear") {
      guard let defaults = sharedDefaults() else { return }
      defaults.removeObject(forKey: snapshotKey)
      WidgetCenter.shared.reloadAllTimelines()
    }
  }
}
