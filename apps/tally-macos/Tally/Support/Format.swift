import Foundation

enum Format {
    static func percent(_ value: Double) -> String {
        "\(Int(value.rounded()))%"
    }

    static func tokens(_ value: Int) -> String {
        let number = Double(value)
        switch abs(number) {
        case 1_000_000_000...: return String(format: "%.1fB", number / 1_000_000_000)
        case 10_000_000...: return String(format: "%.0fM", number / 1_000_000)
        case 1_000_000...: return String(format: "%.1fM", number / 1_000_000)
        case 10_000...: return String(format: "%.0fK", number / 1_000)
        case 1_000...: return String(format: "%.1fK", number / 1_000)
        default: return "\(value)"
        }
    }

    static func usd(_ value: Double) -> String {
        if value == 0 { return "$0" }
        if value < 0.01 { return "<$0.01" }
        return value.formatted(.currency(code: "USD").precision(.fractionLength(value < 100 ? 2 : 0)))
    }

    /// "2h 14m", "3d 4h", "12m" — the coarsest two units that matter.
    static func countdown(to date: Date, from now: Date = .now) -> String {
        let seconds = max(Int(date.timeIntervalSince(now)), 0)
        let days = seconds / 86400
        let hours = (seconds % 86400) / 3600
        let minutes = (seconds % 3600) / 60
        if days > 0 { return hours > 0 ? "\(days)d \(hours)h" : "\(days)d" }
        if hours > 0 { return minutes > 0 ? "\(hours)h \(minutes)m" : "\(hours)h" }
        return minutes > 0 ? "\(minutes)m" : "now"
    }

    static func ago(_ date: Date, from now: Date = .now) -> String {
        let seconds = Int(now.timeIntervalSince(date))
        if seconds < 60 { return "just now" }
        if seconds < 3600 { return "\(seconds / 60)m ago" }
        if seconds < 86400 { return "\(seconds / 3600)h ago" }
        return "\(seconds / 86400)d ago"
    }

    /// `anthropic/claude-haiku-4.5` → `claude-haiku-4.5`.
    static func model(_ id: String) -> String {
        id.split(separator: "/").last.map(String.init) ?? id
    }
}
