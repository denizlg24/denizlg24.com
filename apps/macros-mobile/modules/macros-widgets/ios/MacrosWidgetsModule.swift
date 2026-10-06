import ExpoModulesCore
import WidgetKit

/// Must match `SNAPSHOT_KEY` in widgets/ios/Snapshot.swift.
private let snapshotKey = "snapshot"

/// The App Group's defaults, or nil if the installed signature does not
/// grant the group.
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
