import AppIntents
import Foundation

/// Opens Voice straight into listening: Siri, Shortcuts, the Action Button,
/// Control Center and the Lock Screen all start here.
struct AskIntent: AppIntent {
  static let title: LocalizedStringResource = "Ask Deniz"
  static let description = IntentDescription("Open Voice listening.")

  func perform() async throws -> some IntentResult & OpensIntent {
    .result(opensIntent: OpenURLIntent(URL(string: "voice://listen")!))
  }
}

/// The Live Activity's Stop: ends listening or cuts the reply short. Runs in
/// the app's process, where the module turns it into an event for JS.
struct StopVoiceIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Stop"
  static let isDiscoverable = false

  func perform() async throws -> some IntentResult {
    NotificationCenter.default.post(name: Notification.Name("VoiceStopRequested"), object: nil)
    return .result()
  }
}
