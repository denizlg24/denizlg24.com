import Foundation

/// The parts of `WorkHoursOverview` (@repo/schemas) the widgets, the Live
/// Activity and the intents read. Anything else in the payload is ignored.
public struct Overview: Decodable {
  public struct Job: Decodable {
    public let id: String
    public let name: String
    public let breaksPaid: Bool
    public let expectedWeeklyHours: Double?
    public let status: String
  }

  public struct Break: Decodable {
    public let start: String
    public let end: String?
  }

  public struct Shift: Decodable {
    public let id: String
    public let jobId: String
    public let start: String
    public let end: String?
    public let breaks: [Break]
    public let workedMinutes: Int
  }

  public struct Totals: Decodable {
    public let workedMinutes: Int
  }

  public struct PayPeriod: Decodable {
    public let ruleName: String
    public let payoutDate: String
    public let netMinor: Int
    public let currency: String
  }

  public let jobs: [Job]
  public let active: Shift?
  public let today: Totals
  public let week: Totals
  public let month: Totals
  public let payPeriods: [PayPeriod]
}

public enum ShiftStatus: String, Codable {
  case off, working, onBreak
}

/// Everything a widget draws, derived once from the overview and the moment
/// it was fetched. Running figures are anchors, not values: a `Text` timer
/// counting up from `workedFrom` keeps the lock screen right without reloads.
public struct HoursSnapshot: Codable, Equatable {
  public var fetchedAt: Date
  public var status: ShiftStatus
  public var sessionId: String?
  public var jobName: String?
  public var shiftStart: Date?
  /// Now − worked time on the open shift, unpaid breaks skipped.
  public var workedFrom: Date?
  public var breakFrom: Date?
  /// Worked seconds on the open shift when fetched; frozen during a break.
  public var workedSeconds: Int
  /// Totals without the open shift, so a live figure is base + running time.
  public var todayBaseMinutes: Int
  public var weekBaseMinutes: Int
  public var monthBaseMinutes: Int
  public var weeklyTargetMinutes: Int?
  public var payoutName: String?
  public var payoutDate: Date?
  public var payoutNetMinor: Int?
  public var payoutCurrency: String?
  public var hasJobs: Bool

  public static let signedOut = HoursSnapshot(
    fetchedAt: .distantPast, status: .off, sessionId: nil, jobName: nil,
    shiftStart: nil, workedFrom: nil, breakFrom: nil, workedSeconds: 0,
    todayBaseMinutes: 0, weekBaseMinutes: 0, monthBaseMinutes: 0,
    weeklyTargetMinutes: nil, payoutName: nil, payoutDate: nil,
    payoutNetMinor: nil, payoutCurrency: nil, hasJobs: false)

  /// Live worked seconds on the open shift.
  public func workedSeconds(at now: Date) -> Int {
    guard status == .working, let workedFrom else { return workedSeconds }
    return max(0, Int(now.timeIntervalSince(workedFrom)))
  }

  public func todayMinutes(at now: Date) -> Int {
    todayBaseMinutes + workedSeconds(at: now) / 60
  }

  public func weekMinutes(at now: Date) -> Int {
    weekBaseMinutes + workedSeconds(at: now) / 60
  }

  public var activityState: ShiftAttributes.ContentState? {
    guard let sessionId, let workedFrom, status != .off else { return nil }
    return ShiftAttributes.ContentState(
      sessionId: sessionId,
      status: status == .onBreak ? "break" : "working",
      workedFrom: workedFrom.timeIntervalSince1970,
      breakFrom: breakFrom?.timeIntervalSince1970,
      workedSeconds: workedSeconds)
  }
}

extension Overview {
  /// Mirrors `shiftActivityState` in @repo/utils, which the server pushes.
  public func snapshot(at now: Date = Date()) -> HoursSnapshot {
    let activeJobs = jobs.filter { $0.status == "active" }
    let target = activeJobs.compactMap(\.expectedWeeklyHours).reduce(0, +)
    let payout = payPeriods.sorted { $0.payoutDate < $1.payoutDate }.first
    var snapshot = HoursSnapshot(
      fetchedAt: now, status: .off, sessionId: nil, jobName: nil,
      shiftStart: nil, workedFrom: nil, breakFrom: nil, workedSeconds: 0,
      todayBaseMinutes: today.workedMinutes, weekBaseMinutes: week.workedMinutes,
      monthBaseMinutes: month.workedMinutes,
      weeklyTargetMinutes: target > 0 ? Int(target * 60) : nil,
      payoutName: payout?.ruleName,
      payoutDate: payout.flatMap { HoursDates.day($0.payoutDate) },
      payoutNetMinor: payout?.netMinor, payoutCurrency: payout?.currency,
      hasJobs: !activeJobs.isEmpty)
    guard let active, let start = HoursDates.parse(active.start) else { return snapshot }

    let job = jobs.first { $0.id == active.jobId }
    var breakSeconds = 0.0
    var openBreak: Date?
    for item in active.breaks {
      guard let breakStart = HoursDates.parse(item.start).map({ max($0, start) }) else { continue }
      if let end = HoursDates.parse(item.end) {
        breakSeconds += max(0, end.timeIntervalSince(breakStart))
      } else {
        openBreak = breakStart
        breakSeconds += max(0, now.timeIntervalSince(breakStart))
      }
    }
    let worked = max(0, now.timeIntervalSince(start) - ((job?.breaksPaid ?? false) ? 0 : breakSeconds))
    snapshot.status = openBreak == nil ? .working : .onBreak
    snapshot.sessionId = active.id
    snapshot.jobName = job?.name ?? "Shift"
    snapshot.shiftStart = start
    snapshot.workedFrom = now.addingTimeInterval(-worked)
    snapshot.breakFrom = openBreak
    snapshot.workedSeconds = Int(worked)
    // The overview's totals include the open shift up to the server's now.
    snapshot.todayBaseMinutes = max(0, today.workedMinutes - active.workedMinutes)
    snapshot.weekBaseMinutes = max(0, week.workedMinutes - active.workedMinutes)
    snapshot.monthBaseMinutes = max(0, month.workedMinutes - active.workedMinutes)
    return snapshot
  }
}

/// The last overview, kept raw in the App Group so every process derives
/// from the same payload.
public enum OverviewStore {
  private static let key = "overview"
  private static let fetchedKey = "overviewFetchedAt"

  public static func save(_ data: Data, at date: Date = Date()) {
    HoursShared.defaults?.set(data, forKey: key)
    HoursShared.defaults?.set(date.timeIntervalSince1970, forKey: fetchedKey)
  }

  public static func clear() {
    HoursShared.defaults?.removeObject(forKey: key)
    HoursShared.defaults?.removeObject(forKey: fetchedKey)
  }

  public static var fetchedAt: Date? {
    guard let seconds = HoursShared.defaults?.object(forKey: fetchedKey) as? Double else {
      return nil
    }
    return Date(timeIntervalSince1970: seconds)
  }

  public static func load() -> Overview? {
    guard let data = HoursShared.defaults?.data(forKey: key) else { return nil }
    return try? JSONDecoder().decode(Overview.self, from: data)
  }

  /// The stored snapshot, its running figures moved on to `now`.
  public static func snapshot(at now: Date = Date()) -> HoursSnapshot? {
    guard let overview = load(), let fetchedAt else { return nil }
    var snapshot = overview.snapshot(at: fetchedAt)
    snapshot.fetchedAt = fetchedAt
    if snapshot.status == .onBreak {
      return snapshot
    }
    if snapshot.status == .working {
      snapshot.workedSeconds = snapshot.workedSeconds(at: now)
    }
    return snapshot
  }
}
