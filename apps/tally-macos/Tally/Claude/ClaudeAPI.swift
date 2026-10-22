import Foundation

/// The endpoints Claude Code's own `/usage` reads, called with a seat's
/// subscription OAuth token.
enum ClaudeAPI {
    static let clientID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
    private static let base = URL(string: "https://api.anthropic.com")!
    private static let tokenEndpoints = [
        URL(string: "https://platform.claude.com/v1/oauth/token")!,
        URL(string: "https://console.anthropic.com/v1/oauth/token")!,
    ]

    struct Profile: Decodable, Sendable {
        struct Account: Decodable, Sendable {
            let uuid: String
            let email: String
            let displayName: String?
            let fullName: String?
        }

        struct Organization: Decodable, Sendable {
            let uuid: String?
            let name: String?
            let seatTier: String?
        }

        let account: Account
        let organization: Organization?
    }

    struct TokenResponse: Decodable, Sendable {
        let accessToken: String
        let refreshToken: String?
        let expiresIn: Double
    }

    struct GrantRefused: Error, LocalizedError {
        let detail: String
        var errorDescription: String? { "Sign-in expired (\(detail))" }
    }

    private struct UsagePayload: Decodable {
        struct Window: Decodable {
            let utilization: Double?
            let resetsAt: Date?
        }

        let fiveHour: Window?
        let sevenDay: Window?
        let sevenDayOpus: Window?
        let sevenDaySonnet: Window?
    }

    static func usage(token: String) async throws -> ClaudeUsage {
        let payload = try await HTTP.json(UsagePayload.self, request(path: "/api/oauth/usage", token: token))
        func window(_ value: UsagePayload.Window?, length: TimeInterval) -> UsageWindow? {
            guard let value, let utilization = value.utilization else { return nil }
            return UsageWindow(percent: utilization, resetsAt: value.resetsAt, length: length)
        }
        return ClaudeUsage(
            session: window(payload.fiveHour, length: 5 * 3600),
            week: window(payload.sevenDay, length: 7 * 86400),
            weekOpus: window(payload.sevenDayOpus, length: 7 * 86400),
            weekSonnet: window(payload.sevenDaySonnet, length: 7 * 86400),
            fetchedAt: .now
        )
    }

    static func profile(token: String) async throws -> Profile {
        try await HTTP.json(Profile.self, request(path: "/api/oauth/profile", token: token))
    }

    /// Rotates a seat's token family. Only ever called for a seat Claude Code
    /// is not holding: rotating the live one would strand Claude Code's copy.
    static func refresh(_ refreshToken: String) async throws -> TokenResponse {
        let body = try JSONEncoder().encode([
            "grant_type": "refresh_token",
            "refresh_token": refreshToken,
            "client_id": clientID,
        ])
        var lastError: Error = URLError(.badServerResponse)
        for endpoint in tokenEndpoints {
            var request = URLRequest(url: endpoint)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
            do {
                return try await HTTP.json(TokenResponse.self, request)
            } catch let failure as HTTP.Failure where failure.status == 400 || failure.status == 401 {
                throw GrantRefused(detail: failure.body.contains("invalid_grant") ? "invalid_grant" : "HTTP \(failure.status)")
            } catch {
                lastError = error
            }
        }
        throw lastError
    }

    private static func request(path: String, token: String) -> URLRequest {
        var request = URLRequest(url: base.appendingPathComponent(path))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("oauth-2025-04-20", forHTTPHeaderField: "anthropic-beta")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }
}

struct ClaudeUsage: Codable, Sendable, Equatable {
    var session: UsageWindow?
    var week: UsageWindow?
    var weekOpus: UsageWindow?
    var weekSonnet: UsageWindow?
    var fetchedAt: Date

    /// What decides whether a seat can take more work right now.
    var headroom: Double {
        let spent = max(session?.effectivePercent() ?? 0, week?.effectivePercent() ?? 0)
        return 100 - spent
    }
}
