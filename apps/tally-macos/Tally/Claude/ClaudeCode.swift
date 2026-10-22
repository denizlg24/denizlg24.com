import Foundation

/// Claude Code's own state on this Mac: the keychain item holding its tokens
/// and the `oauthAccount` block in `~/.claude.json`.
///
/// Native keychain access keeps tokens out of process arguments and avoids
/// `security -i`'s 4,096-byte line limit. Background reads and writes prohibit
/// authentication UI; only an explicit seat switch may request access.
///
/// The item also carries `mcpOAuth` (every MCP server's tokens). Only
/// `claudeAiOauth` belongs to a seat; anything else is written back untouched.
enum ClaudeCode {
    static let service = "Claude Code-credentials"

    static var configURL: URL { FileManager.home.appendingPathComponent(".claude.json") }

    static var keychainAccount: String {
        ProcessInfo.processInfo.environment["USER"] ?? NSUserName()
    }

    static func readCredentials(service: String = service, account: String = keychainAccount,
                                allowInteraction: Bool = false) async throws -> JSONValue? {
        try await Task.detached(priority: .utility) {
            guard let data = try Keychain.read(service: service, account: account,
                                               allowInteraction: allowInteraction) else { return nil }
            return try JSONValue.parse(data)
        }.value
    }

    static func writeCredentials(_ document: JSONValue, service: String = service, account: String = keychainAccount) async throws {
        let data = try document.data()
        try await Task.detached(priority: .utility) {
            try Keychain.write(data, service: service, account: account, allowInteraction: false)
        }.value
        // Never mark a switch successful unless we can read the exact
        // document back, including the unrelated MCP credentials.
        guard try await readCredentials(service: service, account: account) == document else {
            throw CredentialError.verificationFailed
        }
    }

    enum CredentialError: LocalizedError {
        case verificationFailed

        var errorDescription: String? {
            "Claude Code credentials did not match after writing. Seat switch was not completed."
        }
    }

    static func readAccount() -> JSONValue? {
        guard let data = try? Data(contentsOf: configURL),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let account = object["oauthAccount"],
              let accountData = try? JSONSerialization.data(withJSONObject: account)
        else { return nil }
        return try? JSONValue.parse(accountData)
    }

    /// Replaces `oauthAccount` and nothing else. Claude Code rewrites this file
    /// constantly, so it is edited as an untyped object, never re-modelled.
    static func writeAccount(_ account: JSONValue) throws {
        let url = configURL
        let data = try Data(contentsOf: url)
        guard var object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw CocoaError(.fileReadCorruptFile)
        }
        object["oauthAccount"] = try JSONSerialization.jsonObject(with: try account.data())
        let output = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .withoutEscapingSlashes])
        let permissions = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.posixPermissions]
        try output.write(to: url, options: [.atomic])
        if let permissions {
            try? FileManager.default.setAttributes([.posixPermissions: permissions], ofItemAtPath: url.path)
        }
    }

    /// The `claude` binary the installer puts on PATH for a login shell.
    static var executable: String {
        let candidates = [
            FileManager.home.appendingPathComponent(".local/bin/claude").path,
            "/opt/homebrew/bin/claude",
            "/usr/local/bin/claude",
        ]
        return candidates.first { FileManager.default.isExecutableFile(atPath: $0) } ?? "claude"
    }
}

/// `claudeAiOauth` as stored by Claude Code. Kept as JSON so fields Tally does
/// not model (scopes, tier, subscription type) survive a switch.
struct ClaudeOAuth: Sendable, Equatable {
    var raw: JSONValue

    var accessToken: String? { raw["accessToken"]?.string }
    var refreshToken: String? { raw["refreshToken"]?.string }

    var expiresAt: Date? {
        raw["expiresAt"]?.number.map { Date(timeIntervalSince1970: $0 / 1000) }
    }

    func isExpired(margin: TimeInterval = 0, at now: Date = .now) -> Bool {
        guard let expiresAt else { return false }
        return expiresAt.addingTimeInterval(-margin) <= now
    }

    /// Identifies a token family without holding the token: the refresh token
    /// changes only when the family rotates, so it outlives access tokens.
    var fingerprint: String {
        let source = refreshToken ?? accessToken ?? ""
        return String(source.suffix(24))
    }

    func applying(_ tokens: ClaudeAPI.TokenResponse, at now: Date = .now) -> ClaudeOAuth {
        var next = raw
        next["accessToken"] = .string(tokens.accessToken)
        if let refresh = tokens.refreshToken {
            next["refreshToken"] = .string(refresh)
        }
        next["expiresAt"] = .int(Int64((now.timeIntervalSince1970 + tokens.expiresIn) * 1000))
        return ClaudeOAuth(raw: next)
    }
}
