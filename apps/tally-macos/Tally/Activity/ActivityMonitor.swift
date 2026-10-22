import Foundation
import Observation

struct DayTotal: Identifiable, Sendable, Equatable {
    var day: Date
    var tool: Tool
    var tokens: Tokens
    var id: String { "\(day.timeIntervalSince1970)-\(tool.rawValue)" }
}

struct ModelTotal: Identifiable, Sendable, Equatable {
    var tool: Tool
    var model: String
    var tokens: Tokens
    var id: String { "\(tool.rawValue)-\(model)" }
}

struct SeatTotal: Identifiable, Sendable, Equatable {
    /// nil for spend before Tally knew which seat was active.
    var seatID: String?
    var tokens: Tokens
    var id: String { seatID ?? "-" }
}

struct ActivitySummary: Sendable, Equatable {
    var days: [DayTotal] = []
    var models: [ModelTotal] = []
    var seats: [SeatTotal] = []
    var today: [Tool: Tokens] = [:]
    var scannedAt: Date?

    static func build(_ buckets: [HourBucket], seatAt: (Date) -> String?, now: Date = .now) -> ActivitySummary {
        let calendar = Calendar.current
        let todayStart = calendar.startOfDay(for: now)
        var days: [String: DayTotal] = [:]
        var models: [String: ModelTotal] = [:]
        var seats: [String: SeatTotal] = [:]
        var today: [Tool: Tokens] = [:]
        for bucket in buckets {
            let day = calendar.startOfDay(for: bucket.hour)
            let dayKey = "\(day.timeIntervalSince1970)-\(bucket.tool.rawValue)"
            days[dayKey, default: DayTotal(day: day, tool: bucket.tool, tokens: Tokens())].tokens += bucket.tokens
            let modelKey = "\(bucket.tool.rawValue)-\(bucket.model)"
            models[modelKey, default: ModelTotal(tool: bucket.tool, model: bucket.model, tokens: Tokens())].tokens += bucket.tokens
            if day == todayStart {
                today[bucket.tool, default: Tokens()] += bucket.tokens
            }
            if bucket.tool == .claude {
                let seat = seatAt(bucket.hour)
                seats[seat ?? "-", default: SeatTotal(seatID: seat, tokens: Tokens())].tokens += bucket.tokens
            }
        }
        return ActivitySummary(
            days: days.values.sorted { ($0.day, $0.tool.rawValue) < ($1.day, $1.tool.rawValue) },
            models: models.values.sorted { $0.tokens.total > $1.tokens.total },
            seats: seats.values.sorted { $0.tokens.total > $1.tokens.total },
            today: today,
            scannedAt: now
        )
    }
}

@MainActor
@Observable
final class ActivityMonitor {
    private(set) var summary = ActivitySummary()
    private(set) var isScanning = false
    @ObservationIgnored private let scanner = ActivityScanner()
    @ObservationIgnored private var inFlight: Task<Void, Never>?

    /// A caller arriving mid-scan waits for that scan rather than starting a
    /// second pass over the same files.
    func refresh(seatAt: @escaping @MainActor (Date) -> String?) async {
        if let inFlight { return await inFlight.value }
        let task = Task { @MainActor in
            isScanning = true
            let buckets = await scanner.scan()
            summary = ActivitySummary.build(buckets, seatAt: seatAt)
            isScanning = false
        }
        inFlight = task
        await task.value
        inFlight = nil
    }
}
