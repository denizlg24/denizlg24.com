import ActivityKit
import Foundation

/// One spoken turn on the Lock Screen and in the Dynamic Island: listening,
/// thinking (with the tool at work), replying, done.
public struct VoiceAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// `listening`, `thinking`, `replying`, `done` or `error`.
    public var phase: String
    /// What was heard, the tool running, or the reply so far.
    public var text: String
    public var startedAt: Double

    public init(phase: String, text: String, startedAt: Double) {
      self.phase = phase
      self.text = text
      self.startedAt = startedAt
    }
  }

  public init() {}
}

/// The last exchange, for the widgets.
public struct VoiceExchange: Codable {
  public var question: String
  public var reply: String
  public var at: Double

  public init(question: String, reply: String, at: Double) {
    self.question = question
    self.reply = reply
    self.at = at
  }

  static let key = "lastExchange"

  public static var defaults: UserDefaults? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "VoiceAppGroup") as? String else {
      return nil
    }
    return UserDefaults(suiteName: group)
  }

  public static func load() -> VoiceExchange? {
    guard let data = defaults?.data(forKey: key) else { return nil }
    return try? JSONDecoder().decode(VoiceExchange.self, from: data)
  }

  public static func save(_ exchange: VoiceExchange?) {
    guard let exchange, let data = try? JSONEncoder().encode(exchange) else {
      defaults?.removeObject(forKey: key)
      return
    }
    defaults?.set(data, forKey: key)
  }
}
