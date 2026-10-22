import Foundation
import Observation

/// `GET /api/admin/llm/usage` — every model call denizlg24.com makes through
/// its LLM service, priced. Wire shape: `llmUsageResponseSchema` in
/// `packages/schemas/src/llm.ts`.
struct SiteUsage: Codable, Sendable, Equatable {
    struct Period: Codable, Sendable, Equatable {
        let totalRequests: Int
        let totalInputTokens: Int
        let totalOutputTokens: Int
        let totalCost: Double
    }

    struct Breakdown: Codable, Sendable, Equatable, Identifiable {
        let name: String
        let requests: Int
        let inputTokens: Int
        let outputTokens: Int
        let cost: Double
        var id: String { name }
    }

    struct Day: Codable, Sendable, Equatable, Identifiable {
        let date: String
        let requests: Int
        let cost: Double
        var id: String { date }

        /// The server buckets by the owner's time zone, so the date is read as
        /// a local calendar day rather than UTC midnight.
        var day: Date? {
            let parts = date.split(separator: "-").compactMap { Int($0) }
            guard parts.count == 3 else { return nil }
            return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
        }
    }

    struct Request: Codable, Sendable, Equatable, Identifiable {
        let id: String
        let llmModel: String
        let inputTokens: Int
        let outputTokens: Int
        let costUsd: Double
        let source: String
        let createdAt: Date

        enum CodingKeys: String, CodingKey {
            case id = "_id", llmModel, inputTokens, outputTokens, costUsd, source, createdAt
        }
    }

    let last24h: Period
    let last7d: Period
    let last30d: Period
    let allTime: Period
    let byModel: [Breakdown]
    let bySource: [Breakdown]
    let dailyBreakdown: [Day]
    let recent: [Request]
    let fetchedAt: Date
}

private struct UsageResponse: Decodable {
    struct Model: Decodable { let model: String; let requests, inputTokens, outputTokens: Int; let cost: Double }
    struct Source: Decodable { let source: String; let requests, inputTokens, outputTokens: Int; let cost: Double }
    struct Recent: Decodable { let items: [SiteUsage.Request] }

    let last24h, last7d, last30d, allTime: SiteUsage.Period
    let byModel: [Model]
    let bySource: [Source]
    let dailyBreakdown: [SiteUsage.Day]
    let recentRequests: Recent
}

@MainActor
@Observable
final class SiteMonitor {
    enum Status: Equatable {
        case signedOut
        case signingIn
        case signedIn
    }

    private(set) var status: Status = .signedOut
    private(set) var usage: SiteUsage?
    private(set) var issue: String?
    private(set) var isRefreshing = false
    @ObservationIgnored let auth = SiteAuth()

    init() {
        usage = Storage.load(SiteUsage.self, from: "site-usage.json")
        Task {
            status = await auth.isSignedIn ? .signedIn : .signedOut
        }
    }

    func signIn() async {
        status = .signingIn
        issue = nil
        do {
            try await auth.signIn()
            status = .signedIn
            await refresh()
        } catch is CancellationError {
            status = .signedOut
        } catch {
            status = .signedOut
            issue = error.localizedDescription
        }
    }

    func cancelSignIn() async {
        await auth.cancelSignIn()
    }

    func signOut() async {
        await auth.signOut()
        status = .signedOut
        usage = nil
        Storage.remove("site-usage.json")
    }

    func refresh() async {
        guard status == .signedIn else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let token = try await auth.token()
            var components = URLComponents(url: SiteAuth.origin.appendingPathComponent("api/admin/llm/usage"), resolvingAgainstBaseURL: false)!
            components.queryItems = [URLQueryItem(name: "limit", value: "40")]
            var request = URLRequest(url: components.url!)
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            let response = try await HTTP.json(UsageResponse.self, request)
            usage = SiteUsage(
                last24h: response.last24h,
                last7d: response.last7d,
                last30d: response.last30d,
                allTime: response.allTime,
                byModel: response.byModel.map { .init(name: $0.model, requests: $0.requests, inputTokens: $0.inputTokens, outputTokens: $0.outputTokens, cost: $0.cost) },
                bySource: response.bySource.map { .init(name: $0.source, requests: $0.requests, inputTokens: $0.inputTokens, outputTokens: $0.outputTokens, cost: $0.cost) },
                dailyBreakdown: response.dailyBreakdown,
                recent: response.recentRequests.items,
                fetchedAt: .now
            )
            issue = nil
            Storage.save(usage, to: "site-usage.json")
        } catch is SiteAuth.GrantRefused {
            status = .signedOut
            issue = "Signed out"
        } catch is SiteAuth.NotSignedIn {
            status = .signedOut
        } catch {
            issue = error.localizedDescription
        }
    }
}
