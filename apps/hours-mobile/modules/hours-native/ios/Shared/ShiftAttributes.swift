import ActivityKit
import Foundation

/// The open shift on the Lock Screen and in the Dynamic Island. The type name
/// is what the server names in a push-to-start (`attributes-type`), and
/// `ContentState` is `shiftActivityStateSchema` in @repo/schemas — keys and
/// all. Instants are Unix seconds: ActivityKit decodes a pushed JSON date as
/// seconds since 2001.
public struct ShiftAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    public var sessionId: String
    /// `working`, `break`, or `ended` once the shift is over.
    public var status: String
    public var workedFrom: Double
    public var breakFrom: Double?
    public var workedSeconds: Int

    public init(
      sessionId: String, status: String, workedFrom: Double, breakFrom: Double?,
      workedSeconds: Int
    ) {
      self.sessionId = sessionId
      self.status = status
      self.workedFrom = workedFrom
      self.breakFrom = breakFrom
      self.workedSeconds = workedSeconds
    }

    public var workedFromDate: Date { Date(timeIntervalSince1970: workedFrom) }
    public var breakFromDate: Date? { breakFrom.map { Date(timeIntervalSince1970: $0) } }
  }

  public var jobName: String

  public init(jobName: String) {
    self.jobName = jobName
  }
}
