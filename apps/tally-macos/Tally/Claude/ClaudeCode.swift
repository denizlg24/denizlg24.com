import Foundation

/// Claude Code's own state on this Mac: the keychain item holding its tokens
/// and the `oauthAccount` block in `~/.claude.json`.
///
/// The shared item must be written by security: native updates reset its
/// partition to Tally's identity, making Claude Code's own reads prompt.
/// Send quoted JSON on stdin (never hex or process arguments), with a strict
/// byte limit checked before touching the item. Background reads preflight
/// the partition and never launch security when it would need authorization.
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
        let readable = try await Task.detached(priority: .utility) {
            try Keychain.allowsAppleTool(service: service, account: account)
        }.value
        if readable {
            do {
                let output = try await Shell.run("/usr/bin/security", ["find-generic-password", "-s", service, "-a", account, "-w"])
                return try decodeCredentialOutput(output)
            } catch let failure as Shell.Failure where failure.status == 44 { return nil }
        }
        // A prior native build may have removed the Apple partition. Read it
        // without UI if possible; an explicit switch can authorize migration.
        return try await Task.detached(priority: .utility) {
            guard let data = try Keychain.read(service: service, account: account, allowInteraction: allowInteraction) else { return nil }
            return try JSONValue.parse(data)
        }.value
    }

    static func writeCredentials(_ document: JSONValue, service: String = service, account: String = keychainAccount) async throws {
        let command = try credentialCommand(document, service: service, account: account)
        _ = try await Shell.run("/usr/bin/security", ["-i"], input: command)
        try await verifyAppleToolCredentials(document, service: service, account: account)
    }

    static func verifyAppleToolCredentials(_ document: JSONValue, service: String, account: String) async throws {
        let readable = try await Task.detached(priority: .utility) {
            try Keychain.allowsAppleTool(service: service, account: account)
        }.value
        // The native migration fallback must never mask broken Claude Code
        // access, or launch security when the Apple-tool partition is absent.
        guard readable else { throw CredentialError.verificationFailed }
        let output = try await Shell.run("/usr/bin/security", ["find-generic-password", "-s", service, "-a", account, "-w"])
        guard try decodeCredentialOutput(output) == document else {
            throw CredentialError.verificationFailed
        }
    }

    enum CredentialError: LocalizedError {
        case verificationFailed
        case oversized
        case invalidIdentity

        var errorDescription: String? {
            switch self {
            case .verificationFailed: "Claude Code credentials did not match after writing. Seat switch was not completed."
            case .oversized: "Claude Code credentials exceed the secure keychain command limit. No credentials were changed."
            case .invalidIdentity: "Invalid keychain service or account. No credentials were changed."
            }
        }
    }

    static func credentialCommand(_ document: JSONValue, service: String, account: String) throws -> Data {
        guard !service.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              !account.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else {
            throw CredentialError.invalidIdentity
        }
        func quote(_ text: String) -> String {
            "\"" + text.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
        }
        let json = String(decoding: try document.data(), as: UTF8.self)
        let command = Data("add-generic-password -U -a \(quote(account)) -s \(quote(service)) -w \(quote(json))\n".utf8)
        guard command.count < 4096 else { throw CredentialError.oversized }
        return command
    }

    /// security prints non-ASCII passwords as unprefixed hex, even with -w.
    static func decodeCredentialOutput(_ output: Data) throws -> JSONValue {
        let text = String(decoding: output, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        if text.first == "{" { return try JSONValue.parse(Data(text.utf8)) }
        var decoded = Data()
        if text.count.isMultiple(of: 2) {
            var index = text.startIndex
            while index < text.endIndex {
                let next = text.index(index, offsetBy: 2)
                guard let byte = UInt8(text[index..<next], radix: 16) else { return try JSONValue.parse(output) }
                decoded.append(byte)
                index = next
            }
        }
        return try JSONValue.parse(decoded)
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
