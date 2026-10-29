import AppKit
import Foundation
import Observation

/// The Claude seats this Mac has signed in to, and which one Claude Code holds.
///
/// Ownership of each seat's token family moves with the switch: while a seat
/// is active, Claude Code owns it (refreshes and rewrites it) and Tally only
/// copies it; once switched away, Tally owns it and is the only thing that may
/// refresh it. Refreshing the active seat would rotate the token out from
/// under Claude Code.
@MainActor
@Observable
final class ClaudeSeats {
    private(set) var seats: [ClaudeSeat] = []
    private(set) var activeSeatID: String?
    private(set) var timeline: [SeatSpan] = []
    private(set) var isSwitching = false
    private(set) var isRefreshing = false
    private(set) var lastEvent: String?
    private(set) var credentialIssue: String?

    /// The seat the owner chose in Tally. When a Claude Code session still
    /// running on an older seat refreshes and writes that seat back, Tally
    /// captures the new tokens and restores this one.
    private var pinnedSeatID: String? {
        didSet { UserDefaults.standard.set(pinnedSeatID, forKey: "claude.pinnedSeat") }
    }

    @ObservationIgnored private let lock = AsyncLock()
    @ObservationIgnored private var seatsByFingerprint: [String: String] = [:]

    init() {
        seats = Storage.load([ClaudeSeat].self, from: "claude-seats.json") ?? []
        timeline = Storage.load([SeatSpan].self, from: "claude-timeline.json") ?? []
        pinnedSeatID = UserDefaults.standard.string(forKey: "claude.pinnedSeat")
    }

    var activeSeat: ClaudeSeat? { seats.first { $0.id == activeSeatID } }

    /// The seat with the most room left, other than the active one.
    var bestAlternative: ClaudeSeat? {
        seats
            .filter { $0.id != activeSeatID && !$0.signedOut }
            .max { ($0.usage?.headroom ?? 0) < ($1.usage?.headroom ?? 0) }
    }

    func seatID(at date: Date) -> String? {
        timeline.last { $0.from <= date }?.seatID
    }

    // MARK: Capture

    /// Reads which seat Claude Code holds and copies its current tokens into
    /// the vault. Cheap and frequent, so the vault is never more than one tick
    /// behind a refresh Claude Code made — which matters the moment the owner
    /// signs in to another seat and the old tokens are overwritten.
    func sync() async {
        await lock.run { await syncLocked() }
    }

    private func syncLocked() async {
        do {
            guard let document = try await ClaudeCode.readCredentials(),
                  let raw = document["claudeAiOauth"]
            else {
                activeSeatID = nil
                credentialIssue = "Claude Code is signed out"
                return
            }
            credentialIssue = nil
            let oauth = ClaudeOAuth(raw: raw)
            guard let seatID = try await identify(oauth) else { return }
            seatsByFingerprint[oauth.fingerprint] = seatID

            let account = ClaudeCode.readAccount()
            let accountMatches = account?["accountUuid"]?.string == seatID
            let known = seats.contains { $0.id == seatID }

            if known, let pinned = pinnedSeatID, pinned != seatID,
               seats.contains(where: { $0.id == pinned }) {
                try storeTokens(oauth, account: accountMatches ? account : nil, for: seatID)
                try await install(pinned, into: document)
                note("Restored \(title(pinned)) after a session on \(title(seatID)) refreshed")
                return
            }

            if !known {
                try await adopt(seatID, oauth: oauth, account: accountMatches ? account : nil)
            } else {
                try storeTokens(oauth, account: accountMatches ? account : nil, for: seatID)
            }

            // Claude Code may rewrite ~/.claude.json from a session that started
            // on another seat; the keychain is the truth, so the block follows it.
            if !accountMatches, let stored = SeatVault.secret(for: seatID)?.account {
                try? ClaudeCode.writeAccount(stored)
            }
            markActive(seatID)
            pinnedSeatID = seatID
        } catch {
            credentialIssue = error.localizedDescription
        }
    }

    private func identify(_ oauth: ClaudeOAuth) async throws -> String? {
        if let known = seatsByFingerprint[oauth.fingerprint] { return known }
        if let stashed = seats.first(where: {
            SeatVault.secret(for: $0.id).map { ClaudeOAuth(raw: $0.oauth).fingerprint } == oauth.fingerprint
        }) {
            return stashed.id
        }
        if let token = oauth.accessToken, !oauth.isExpired() {
            return try await ClaudeAPI.profile(token: token).account.uuid
        }
        return ClaudeCode.readAccount()?["accountUuid"]?.string
    }

    private func adopt(_ seatID: String, oauth: ClaudeOAuth, account: JSONValue?) async throws {
        var seat = ClaudeSeat(
            id: seatID,
            email: account?["emailAddress"]?.string ?? "",
            name: account?["displayName"]?.string,
            organization: account?["organizationName"]?.string,
            addedAt: .now
        )
        if let token = oauth.accessToken, seat.email.isEmpty || seat.organization == nil {
            if let profile = try? await ClaudeAPI.profile(token: token) {
                seat.email = profile.account.email
                seat.name = seat.name ?? profile.account.displayName ?? profile.account.fullName
                seat.organization = seat.organization ?? profile.organization?.name
            }
        }
        seats.append(seat)
        try storeTokens(oauth, account: account, for: seatID)
        save()
        note("Added \(seat.title)")
    }

    private func storeTokens(_ oauth: ClaudeOAuth, account: JSONValue?, for seatID: String) throws {
        let existing = SeatVault.secret(for: seatID)
        let next = SeatSecret(oauth: oauth.raw, account: account ?? existing?.account)
        guard existing?.oauth != next.oauth || existing?.account != next.account else { return }
        try SeatVault.store(next, for: seatID)
        update(seatID) { $0.signedOut = false }
    }

    private func markActive(_ seatID: String) {
        guard activeSeatID != seatID else { return }
        activeSeatID = seatID
        if timeline.last?.seatID != seatID {
            timeline.append(SeatSpan(seatID: seatID, from: .now))
            timeline = Array(timeline.suffix(500))
            Storage.save(timeline, to: "claude-timeline.json")
        }
    }

    // MARK: Switch

    func switchTo(_ seatID: String, allowInteraction: Bool = true) async throws {
        try await lock.run {
            isSwitching = true
            defer { isSwitching = false }
            await syncLocked()
            guard seatID != activeSeatID else { return }
            let document = try await ClaudeCode.readCredentials(allowInteraction: allowInteraction) ?? .object([:])
            try await install(seatID, into: document, allowInteraction: allowInteraction)
            note("Switched to \(title(seatID))")
        }
    }

    /// Writes a stashed seat into Claude Code: its tokens into the keychain item
    /// (keeping every other key, notably `mcpOAuth`) and its account block into
    /// `~/.claude.json`. Sessions already running keep the seat they started on.
    private func install(_ seatID: String, into document: JSONValue, allowInteraction: Bool = false) async throws {
        guard var secret = try SeatVault.readSecret(for: seatID, allowInteraction: allowInteraction) else {
            throw SeatError.missingTokens(title(seatID))
        }
        var oauth = ClaudeOAuth(raw: secret.oauth)
        if oauth.isExpired(margin: 300), let refresh = oauth.refreshToken {
            oauth = oauth.applying(try await ClaudeAPI.refresh(refresh))
            secret.oauth = oauth.raw
            try SeatVault.store(secret, for: seatID)
        }
        var next = document
        if case .object = next {} else { next = .object([:]) }
        next["claudeAiOauth"] = oauth.raw
        try await ClaudeCode.writeCredentials(next)
        if let account = secret.account {
            try ClaudeCode.writeAccount(account)
        }
        seatsByFingerprint[oauth.fingerprint] = seatID
        markActive(seatID)
        pinnedSeatID = seatID
    }

    // MARK: Usage

    func refreshUsage() async {
        isRefreshing = true
        defer { isRefreshing = false }
        for seat in seats {
            do {
                guard let token = try await accessToken(for: seat.id) else { continue }
                let usage = try await ClaudeAPI.usage(token: token)
                update(seat.id) {
                    $0.usage = usage
                    $0.issue = nil
                }
            } catch is ClaudeAPI.GrantRefused {
                update(seat.id) {
                    $0.signedOut = true
                    $0.issue = "Signed out"
                }
            } catch {
                update(seat.id) { $0.issue = error.localizedDescription }
            }
        }
        save()
    }

    /// The active seat's token is read live and never refreshed here; when it
    /// has expired, Claude Code will refresh it the next time it is used, and
    /// until then the seat's last reading stands.
    private func accessToken(for seatID: String) async throws -> String? {
        if seatID == activeSeatID {
            guard let raw = try await ClaudeCode.readCredentials()?["claudeAiOauth"] else { return nil }
            let oauth = ClaudeOAuth(raw: raw)
            return oauth.isExpired() ? nil : oauth.accessToken
        }
        return try await lock.run {
            guard seatID != activeSeatID, var secret = SeatVault.secret(for: seatID) else { return nil }
            var oauth = ClaudeOAuth(raw: secret.oauth)
            if oauth.isExpired(margin: 300) {
                guard let refresh = oauth.refreshToken else { return nil }
                oauth = oauth.applying(try await ClaudeAPI.refresh(refresh))
                secret.oauth = oauth.raw
                try SeatVault.store(secret, for: seatID)
            }
            return oauth.accessToken
        }
    }

    // MARK: Seats

    /// Opens Terminal on `claude auth login`. The new seat is adopted by the
    /// next sync, once Claude Code has written its tokens.
    func addSeat() async {
        await sync()
        let script = FileManager.default.temporaryDirectory.appendingPathComponent("tally-claude-login.command")
        let body = """
        #!/bin/zsh -l
        clear
        "\(ClaudeCode.executable)" auth login
        """
        do {
            try body.write(to: script, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: script.path)
            NSWorkspace.shared.open(script)
        } catch {
            note(error.localizedDescription)
        }
    }

    func rename(_ seatID: String, to nickname: String) {
        let trimmed = nickname.trimmingCharacters(in: .whitespaces)
        update(seatID) { $0.nickname = trimmed.isEmpty ? nil : trimmed }
        save()
    }

    func forget(_ seatID: String) {
        guard seatID != activeSeatID else { return }
        seats.removeAll { $0.id == seatID }
        SeatVault.remove(seatID)
        seatsByFingerprint = seatsByFingerprint.filter { $0.value != seatID }
        save()
    }

    func move(from source: IndexSet, to destination: Int) {
        seats.move(fromOffsets: source, toOffset: destination)
        save()
    }

    private func update(_ seatID: String, _ change: (inout ClaudeSeat) -> Void) {
        guard let index = seats.firstIndex(where: { $0.id == seatID }) else { return }
        change(&seats[index])
    }

    private func title(_ seatID: String) -> String {
        seats.first { $0.id == seatID }?.title ?? "seat"
    }

    private func note(_ message: String) {
        lastEvent = message
    }

    private func save() {
        Storage.save(seats, to: "claude-seats.json")
    }
}

enum SeatError: LocalizedError {
    case missingTokens(String)

    var errorDescription: String? {
        switch self {
        case .missingTokens(let seat): "No stored sign-in for \(seat)"
        }
    }
}
