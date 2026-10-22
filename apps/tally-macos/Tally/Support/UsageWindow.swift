import Foundation

/// One rate-limit window as either provider reports it: how much of it is
/// spent and when it starts over.
struct UsageWindow: Codable, Sendable, Equatable {
    var percent: Double
    var resetsAt: Date?
    var length: TimeInterval?

    /// A window whose reset has passed is empty, whatever the last poll said —
    /// an idle seat is not re-polled just to learn that.
    func effectivePercent(at now: Date = .now) -> Double {
        if let resetsAt, resetsAt <= now { return 0 }
        return min(max(percent, 0), 100)
    }

    func hasReset(at now: Date = .now) -> Bool {
        guard let resetsAt else { return false }
        return resetsAt <= now
    }
}

enum UsageLevel {
    case calm, warm, hot

    init(_ percent: Double) {
        switch percent {
        case ..<60: self = .calm
        case ..<85: self = .warm
        default: self = .hot
        }
    }
}
