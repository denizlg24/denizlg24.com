import AppIntents
import Foundation

#if canImport(LocationNative)
  // In the app target the tracker and the store live in the LocationNative
  // pod; the widget extension compiles its own copy of the store.
  internal import LocationNative
#endif

/// Every way to switch exploring without opening the app: the widget button,
/// Control Center, Siri, Shortcuts and the Action Button.
///
/// `LiveActivityIntent` runs `perform` in the app's process, which is the only
/// one that can start location updates; the extension's copy never runs.
@MainActor
func setExploring(_ on: Bool) {
  #if LOCATION_WIDGET_EXTENSION
    var snapshot = ExploreStore.read()
    snapshot.exploring = on
    ExploreStore.write(snapshot)
  #else
    LocationTracker.shared.setExploring(on)
  #endif
}

struct StartExploringIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Start Exploring"
  static let description = IntentDescription("Record the trail until you stop.")

  func perform() async throws -> some IntentResult & ProvidesDialog {
    await setExploring(true)
    return .result(dialog: "Exploring.")
  }
}

struct StopExploringIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Stop Exploring"

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let distance = ExploreStore.read().distanceMetres
    await setExploring(false)
    return .result(dialog: "Stopped. \(ExploreFormat.distance(distance)).")
  }
}

/// The widget button and the Action Button: on when off, off when on.
struct ToggleExploringIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Toggle Exploring"

  func perform() async throws -> some IntentResult {
    await setExploring(!ExploreStore.read().exploring)
    return .result()
  }
}

/// The Control Center toggle's write side.
struct SetExploringIntent: SetValueIntent, LiveActivityIntent {
  static let title: LocalizedStringResource = "Set Exploring"

  @Parameter(title: "Exploring")
  var value: Bool

  func perform() async throws -> some IntentResult {
    await setExploring(value)
    return .result()
  }
}
