import Foundation

/// The part of `DashboardToday` (`@repo/schemas`) the widgets and intents
/// read. Unknown keys are ignored, so the server can add sections freely.
public struct TodayPayload: Codable {
  public struct AgendaItem: Codable, Identifiable {
    public let id: String
    public let kind: String
    public let title: String
    public let start: String
    public let end: String?
    public let allDay: Bool
    public let place: String?

    public var startDate: Date? { DashboardDates.parse(start) }
    public var endDate: Date? { DashboardDates.parse(end) }
  }

  public struct Counts: Codable {
    public let triage: Int
    public let actionNeeded: Int
    public let unreadMail: Int
    public let newContacts: Int
    public let pendingComments: Int
    public let budgetAlerts: Int
  }

  public struct Deadline: Codable {
    public let courseId: String
    public let courseName: String
    public let title: String
    public let dueAt: String
    public let overdue: Bool
  }

  public struct Budget: Codable {
    public let currency: String
    public let plannedMinor: Int
    public let spentMinor: Int
    public let availableMinor: Int
  }

  public struct Todo: Codable, Identifiable {
    public let elementId: String
    public let itemId: String
    public let text: String
    public let completed: Bool
    public var id: String { "\(elementId):\(itemId)" }
  }

  public struct Board: Codable {
    public let whiteboardId: String?
    public let todos: [Todo]
  }

  public let generatedAt: String
  public let day: String
  public let agenda: [AgendaItem]
  public let counts: Counts
  public let nextDeadline: Deadline?
  public let budget: Budget?
  public let board: Board

  public static let empty = TodayPayload(
    generatedAt: "", day: "", agenda: [],
    counts: Counts(
      triage: 0, actionNeeded: 0, unreadMail: 0, newContacts: 0, pendingComments: 0,
      budgetAlerts: 0),
    nextDeadline: nil, budget: nil, board: Board(whiteboardId: nil, todos: []))

  /// The next class that has not ended, for the Next class widget.
  public func nextClass(after now: Date) -> AgendaItem? {
    agenda.first { item in
      item.kind == "class" && (item.endDate ?? item.startDate ?? .distantPast) > now
    }
  }

  /// Timed items that have not ended yet.
  public func upcoming(after now: Date) -> [AgendaItem] {
    agenda.filter { item in
      item.allDay || (item.endDate ?? item.startDate ?? .distantPast) > now
    }
  }
}

public struct TodaySnapshot {
  public let payload: TodayPayload
  public let fetchedAt: Date
  public let signedIn: Bool

  public static let signedOut = TodaySnapshot(payload: .empty, fetchedAt: .distantPast, signedIn: false)
}

public enum TodayStore {
  public static func stored() -> TodaySnapshot? {
    guard let loaded = SnapshotStore.load(.today),
      let payload = try? JSONDecoder().decode(TodayPayload.self, from: loaded.data)
    else { return nil }
    return TodaySnapshot(payload: payload, fetchedAt: loaded.at, signedIn: true)
  }

  /// Fetches Today, keeps it for every process, and returns it.
  @discardableResult
  public static func refresh() async throws -> TodaySnapshot {
    let data = try await DashboardAPI.request("dashboard/today")
    guard let payload = try? JSONDecoder().decode(TodayPayload.self, from: data) else {
      throw DashboardError.unreadable
    }
    SnapshotStore.save(.today, data)
    return TodaySnapshot(payload: payload, fetchedAt: Date(), signedIn: true)
  }

  /// What is stored, refetched once it is older than `maxAge`.
  public static func current(maxAge: TimeInterval) async -> TodaySnapshot {
    if let stored = stored(), Date().timeIntervalSince(stored.fetchedAt) < maxAge {
      return stored
    }
    if let fresh = try? await refresh() { return fresh }
    if let stored = stored() { return stored }
    return SessionKeychain.read() == nil ? .signedOut : TodaySnapshot(payload: .empty, fetchedAt: Date(), signedIn: true)
  }
}

/// Quotes the app already paid for, as `@repo/schemas` `DashboardWatchlistQuote`.
public struct WatchlistQuote: Codable, Identifiable {
  public let symbol: String
  public let price: Double?
  public let changePercent: Double?
  public let currency: String?
  public var id: String { symbol }
}

public enum WatchlistStore {
  public static func stored() -> (quotes: [WatchlistQuote], at: Date)? {
    guard let loaded = SnapshotStore.load(.watchlist),
      let quotes = try? JSONDecoder().decode([WatchlistQuote].self, from: loaded.data)
    else { return nil }
    return (quotes, loaded.at)
  }
}
