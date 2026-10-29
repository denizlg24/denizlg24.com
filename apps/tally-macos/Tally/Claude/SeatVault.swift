import Foundation

struct ClaudeSeat: Codable, Identifiable, Sendable, Equatable {
    /// Claude's account uuid — one per seat, stable across sign-ins.
    let id: String
    var email: String
    var name: String?
    var organization: String?
    var nickname: String?
    var addedAt: Date
    var usage: ClaudeUsage?
    var issue: String?
    var signedOut: Bool = false

    var title: String { nickname ?? name ?? email }
}

/// What Claude Code needs to become a seat: its token family and the
/// `oauthAccount` block that names it.
struct SeatSecret: Codable, Sendable {
    var oauth: JSONValue
    var account: JSONValue?
}

/// Which seat Claude Code held from when. Local token logs carry no account,
/// so this is the only way to attribute them.
struct SeatSpan: Codable, Sendable, Equatable {
    var seatID: String
    var from: Date
}

enum SeatVault {
    private static let service = "com.denizlg24.tally.claude-seat"

    static func secret(for seatID: String, allowInteraction: Bool = false) -> SeatSecret? {
        try? readSecret(for: seatID, allowInteraction: allowInteraction)
    }

    static func readSecret(for seatID: String, allowInteraction: Bool = false) throws -> SeatSecret? {
        guard let data = try Keychain.read(service: service, account: seatID, allowInteraction: allowInteraction) else { return nil }
        return try JSONDecoder().decode(SeatSecret.self, from: data)
    }

    static func store(_ secret: SeatSecret, for seatID: String) throws {
        try Keychain.write(try JSONEncoder().encode(secret), service: service, account: seatID)
    }

    static func remove(_ seatID: String) {
        Keychain.delete(service: service, account: seatID)
    }
}
