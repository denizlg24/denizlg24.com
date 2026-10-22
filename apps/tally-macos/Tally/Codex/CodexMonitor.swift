import Foundation
import Observation

struct CodexUsage: Codable, Sendable, Equatable {
    enum Source: String, Codable, Sendable {
        case live
        case sessionLog
    }

    var plan: String?
    var session: UsageWindow?
    var week: UsageWindow?
    var limitReached: Bool
    var source: Source
    var fetchedAt: Date
}

/// Codex's subscription limits. The live endpoint is what the Codex CLI's
/// `/status` reads; when it cannot be reached (the CLI has not refreshed an
/// expired token yet) the last `token_count` event in a session log carries
/// the same windows as of that turn.
///
/// Tally never refreshes Codex's token: the CLI owns that family, and a
/// rotation here would sign it out.
@MainActor
@Observable
final class CodexMonitor {
    private(set) var usage: CodexUsage?
    private(set) var issue: String?
    private(set) var isRefreshing = false

    init() {
        usage = Storage.load(CodexUsage.self, from: "codex-usage.json")
    }

    func refresh() async {
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            usage = try await CodexAPI.usage()
            issue = nil
        } catch {
            if let logged = await Task.detached(priority: .utility, operation: { CodexSessionLog.latestLimits() }).value,
               logged.fetchedAt > (usage?.fetchedAt ?? .distantPast) || usage?.source == .sessionLog {
                usage = logged
            }
            issue = error.localizedDescription
        }
        if let usage { Storage.save(usage, to: "codex-usage.json") }
    }
}

enum CodexAPI {
    private static let endpoint = URL(string: "https://chatgpt.com/backend-api/wham/usage")!

    static var home: URL {
        if let custom = ProcessInfo.processInfo.environment["CODEX_HOME"] {
            return URL(fileURLWithPath: custom)
        }
        return FileManager.home.appendingPathComponent(".codex")
    }

    private struct Auth: Decodable {
        struct Tokens: Decodable {
            let accessToken: String
            let accountId: String?
        }

        let tokens: Tokens?
    }

    private struct Payload: Decodable {
        struct RateLimit: Decodable {
            let limitReached: Bool?
            let primaryWindow: Window?
            let secondaryWindow: Window?
        }

        struct Window: Decodable {
            let usedPercent: Double
            let limitWindowSeconds: Double?
            let resetAt: Date?
        }

        let planType: String?
        let rateLimit: RateLimit?
    }

    struct NotSignedIn: Error, LocalizedError {
        var errorDescription: String? { "Codex is not signed in with ChatGPT" }
    }

    static func usage() async throws -> CodexUsage {
        let data = try Data(contentsOf: home.appendingPathComponent("auth.json"))
        guard let tokens = try HTTP.decoder.decode(Auth.self, from: data).tokens else { throw NotSignedIn() }
        var request = URLRequest(url: endpoint)
        request.setValue("Bearer \(tokens.accessToken)", forHTTPHeaderField: "Authorization")
        if let account = tokens.accountId {
            request.setValue(account, forHTTPHeaderField: "ChatGPT-Account-Id")
        }
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let payload = try await HTTP.json(Payload.self, request)
        func window(_ value: Payload.Window?) -> UsageWindow? {
            value.map { UsageWindow(percent: $0.usedPercent, resetsAt: $0.resetAt, length: $0.limitWindowSeconds) }
        }
        return CodexUsage(
            plan: payload.planType,
            session: window(payload.rateLimit?.primaryWindow),
            week: window(payload.rateLimit?.secondaryWindow),
            limitReached: payload.rateLimit?.limitReached ?? false,
            source: .live,
            fetchedAt: .now
        )
    }
}

enum CodexSessionLog {
    /// The newest `rate_limits` any session recorded.
    static func latestLimits() -> CodexUsage? {
        let sessions = CodexAPI.home.appendingPathComponent("sessions")
        let files = ActivityFiles.jsonl(under: sessions, modifiedAfter: .now.addingTimeInterval(-7 * 86400))
            .sorted { $0.modified > $1.modified }
            .prefix(5)
        for file in files {
            guard let data = try? Data(contentsOf: file.url, options: .alwaysMapped) else { continue }
            var latest: CodexUsage?
            JSONLines.forEach(in: data, from: 0, containing: ["\"rate_limits\""]) { line in
                if let parsed = parse(line) { latest = parsed }
            }
            if let latest { return latest }
        }
        return nil
    }

    static func parse(_ line: Data) -> CodexUsage? {
        guard let object = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
              let payload = object["payload"] as? [String: Any],
              let limits = payload["rate_limits"] as? [String: Any]
        else { return nil }
        let at = (object["timestamp"] as? String).flatMap(ISO8601.parse) ?? .now
        func window(_ key: String) -> UsageWindow? {
            guard let value = limits[key] as? [String: Any],
                  let used = (value["used_percent"] as? NSNumber)?.doubleValue
            else { return nil }
            let minutes = (value["window_minutes"] as? NSNumber)?.doubleValue
            let resets = (value["resets_at"] as? NSNumber).map { Date(timeIntervalSince1970: $0.doubleValue) }
            return UsageWindow(percent: used, resetsAt: resets, length: minutes.map { $0 * 60 })
        }
        return CodexUsage(
            plan: limits["plan_type"] as? String,
            session: window("primary"),
            week: window("secondary"),
            limitReached: limits["rate_limit_reached_type"] is String,
            source: .sessionLog,
            fetchedAt: at
        )
    }
}
