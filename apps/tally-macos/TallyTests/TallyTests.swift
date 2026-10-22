import Foundation
import Testing
import Security
@testable import Tally

struct DateParsingTests {
    @Test func parsesClaudeResetTimestamps() throws {
        let date = try #require(ISO8601.parse("2026-10-22T18:19:59.880509+00:00"))
        #expect(date.timeIntervalSince1970.rounded() == 1792693200)
    }

    @Test func parsesSessionLogTimestamps() throws {
        let date = try #require(ISO8601.parse("2026-10-22T15:07:40.511Z"))
        #expect(Int(date.timeIntervalSince1970) == 1792681660)
    }
}

struct JSONValueTests {
    @Test func roundTripsUnknownKeysAndIntegers() throws {
        let source = #"{"claudeAiOauth":{"expiresAt":1792707377003,"scopes":["a"]},"mcpOAuth":{"x|1":{"t":"v"}}}"#
        let value = try JSONValue.parse(Data(source.utf8))
        let again = try JSONValue.parse(try value.data())
        #expect(again == value)
        #expect(again["claudeAiOauth"]?["expiresAt"] == .int(1792707377003))
        #expect(again["mcpOAuth"]?["x|1"]?["t"]?.string == "v")
    }

    @Test func replacingOneKeyKeepsTheRest() throws {
        var document = try JSONValue.parse(Data(#"{"claudeAiOauth":{"accessToken":"a"},"mcpOAuth":{"k":1}}"#.utf8))
        document["claudeAiOauth"] = .object(["accessToken": .string("b")])
        #expect(document["mcpOAuth"]?["k"] == .int(1))
        #expect(document["claudeAiOauth"]?["accessToken"]?.string == "b")
    }
}

struct CredentialWriteTests {
    @Test func repairsNativeWriterPartitionWithoutBreakingClaudeCodeReads() async throws {
        let service = "com.denizlg24.tally.test.\(UUID().uuidString)"
        let account = "regression"
        defer { Keychain.delete(service: service, account: account) }
        _ = try await Shell.run("/usr/bin/security", ["add-generic-password", "-s", service,
            "-a", account, "-w", "public-fixture", "-T", "/usr/bin/security", "-T", Bundle.main.bundlePath])
        let document: JSONValue = .object(["claudeAiOauth": .object(["accessToken": .string("fixture")])])
        // Reproduce 0.1.0: data stays valid but the shared partition changes.
        try Keychain.write(try document.data(), service: service, account: account)
        #expect(try !Keychain.allowsAppleTool(service: service, account: account))
        #expect(try await ClaudeCode.readCredentials(service: service, account: account) == document)
        try await ClaudeCode.writeCredentials(document, service: service, account: account)
        #expect(try Keychain.allowsAppleTool(service: service, account: account))
        let output = try await Shell.run("/usr/bin/security", ["find-generic-password", "-s", service, "-a", account, "-w"])
        #expect(try ClaudeCode.decodeCredentialOutput(output) == document)
    }

    @Test func backgroundReadOfUntrustedItemFailsWithoutPrompting() async throws {
        let service = "com.denizlg24.tally.test.\(UUID().uuidString)"
        let account = "regression"
        defer { Keychain.delete(service: service, account: account) }
        // An item trusting security, but not Tally, reproduces the ACL that
        // previously opened a dialog on every background poll.
        _ = try await Shell.run("/usr/bin/security", ["add-generic-password", "-s", service,
                                                      "-a", account, "-w", "public-fixture",
                                                      "-T", "/usr/bin/security"])
        do {
            _ = try Keychain.read(service: service, account: account, allowInteraction: false)
            Issue.record("An untrusted background read should require authorization")
        } catch let failure as Keychain.Failure {
            #expect([errSecInteractionNotAllowed, errSecInteractionRequired, errSecAuthFailed].contains(failure.status),
                    "Unexpected keychain status: \(failure.status)")
        }
    }

    @Test func switchesDocumentsWithoutChangingAppleToolAccess() async throws {
        let service = "com.denizlg24.tally.test.\(UUID().uuidString)"
        let account = "regression"
        defer { Keychain.delete(service: service, account: account) }

        var document: JSONValue = .object([
            "claudeAiOauth": .object(["accessToken": .string("first-seat")]),
            "mcpOAuth": .object([
                "server": .object(["accessToken": .string(String(repeating: "a", count: 2100) + "\"\\\n☃")]),
            ]),
            "unknownField": .object(["preserved": .bool(true)]),
        ])
        try await ClaudeCode.writeCredentials(document, service: service, account: account)
        #expect(try await ClaudeCode.readCredentials(service: service, account: account) == document)

        document["claudeAiOauth"] = .object(["accessToken": .string("second-seat")])
        try await ClaudeCode.writeCredentials(document, service: service, account: account)
        let installed = try await ClaudeCode.readCredentials(service: service, account: account)
        #expect(installed == document)
        #expect(installed?["mcpOAuth"] == document["mcpOAuth"])
        #expect(try Keychain.allowsAppleTool(service: service, account: account))
        // An independent process must still be able to read after both writes.
        let output = try await Shell.run("/usr/bin/security", ["find-generic-password", "-s", service, "-a", account, "-w"])
        #expect(try ClaudeCode.decodeCredentialOutput(output) == document)
        let oversized: JSONValue = .object(["token": .string(String(repeating: "x", count: 32_000))])
        await #expect(throws: ClaudeCode.CredentialError.self) {
            try await ClaudeCode.writeCredentials(oversized, service: service, account: account)
        }
        #expect(try await ClaudeCode.readCredentials(service: service, account: account) == document)
    }
}

/// Explicitly opt in on a development Mac with at least two saved seats.
/// Switches to another seat and restores the original, using the app's lock.
@MainActor
struct LiveSeatSwitchTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["TALLY_VERIFY_LIVE_SWITCH"] == "1"))
    func switchesAndRestoresSavedSeat() async throws {
        let seats = AppModel.shared.claude
        await seats.sync()
        let original = try #require(seats.activeSeatID)
        let alternative = try #require(seats.bestAlternative)
        let before = try #require(try await ClaudeCode.readCredentials())
        do {
            try await seats.switchTo(alternative.id, allowInteraction: false)
            #expect(seats.activeSeatID == alternative.id)
            #expect(ClaudeCode.readAccount()?["accountUuid"]?.string == alternative.id)
            let installed = try #require(try await ClaudeCode.readCredentials())
            #expect(installed["claudeAiOauth"] == SeatVault.secret(for: alternative.id)?.oauth)
            var unrelated = installed
            unrelated["claudeAiOauth"] = before["claudeAiOauth"]
            #expect(unrelated == before)
        } catch {
            try await seats.switchTo(original, allowInteraction: false)
            throw error
        }
        try await seats.switchTo(original, allowInteraction: false)
        #expect(seats.activeSeatID == original)
        #expect(ClaudeCode.readAccount()?["accountUuid"]?.string == original)
        #expect(try await ClaudeCode.readCredentials() == before)
        if let restore = ProcessInfo.processInfo.environment["TALLY_LIVE_RESTORE_SEAT"] {
            try await seats.switchTo(restore, allowInteraction: false)
            #expect(seats.activeSeatID == restore)
        }
    }
}

struct ClaudeOAuthTests {
    @Test func applyingATokenResponseKeepsUnmodelledFields() throws {
        let raw = try JSONValue.parse(Data(#"{"accessToken":"old","refreshToken":"r1","expiresAt":1,"subscriptionType":"team"}"#.utf8))
        let response = try HTTP.decoder.decode(
            ClaudeAPI.TokenResponse.self,
            from: Data(#"{"access_token":"new","refresh_token":"r2","expires_in":3600}"#.utf8)
        )
        let now = Date(timeIntervalSince1970: 1000)
        let next = ClaudeOAuth(raw: raw).applying(response, at: now)
        #expect(next.accessToken == "new")
        #expect(next.refreshToken == "r2")
        #expect(next.expiresAt == Date(timeIntervalSince1970: 4600))
        #expect(next.raw["subscriptionType"]?.string == "team")
    }

    @Test func expiryUsesMilliseconds() throws {
        let raw = try JSONValue.parse(Data(#"{"expiresAt":2000000}"#.utf8))
        let oauth = ClaudeOAuth(raw: raw)
        #expect(oauth.isExpired(at: Date(timeIntervalSince1970: 2001)))
        #expect(!oauth.isExpired(at: Date(timeIntervalSince1970: 1999)))
        #expect(oauth.isExpired(margin: 300, at: Date(timeIntervalSince1970: 1800)))
    }
}

struct UsageWindowTests {
    @Test func aPassedResetReadsAsEmpty() {
        let window = UsageWindow(percent: 80, resetsAt: Date(timeIntervalSince1970: 100), length: 3600)
        #expect(window.effectivePercent(at: Date(timeIntervalSince1970: 50)) == 80)
        #expect(window.effectivePercent(at: Date(timeIntervalSince1970: 101)) == 0)
    }

    @Test func headroomIsTheTighterWindow() {
        let future = Date.now.addingTimeInterval(3600)
        let usage = ClaudeUsage(
            session: UsageWindow(percent: 30, resetsAt: future),
            week: UsageWindow(percent: 70, resetsAt: future),
            fetchedAt: .now
        )
        #expect(usage.headroom == 30)
    }
}

struct JSONLinesTests {
    @Test func stopsAtTheLastCompleteLine() {
        let data = Data("{\"a\":1}\n{\"usage\":2}\n{\"usage\":3".utf8)
        var seen: [String] = []
        let offset = JSONLines.forEach(in: data, from: 0, containing: ["\"usage\""]) {
            seen.append(String(decoding: $0, as: UTF8.self))
        }
        #expect(seen == ["{\"usage\":2}"])
        #expect(offset == 20)
    }

    @Test func resumesFromAnOffset() {
        let data = Data("{\"usage\":1}\n{\"usage\":2}\n".utf8)
        var count = 0
        let offset = JSONLines.forEach(in: data, from: 12, containing: ["\"usage\""]) { _ in count += 1 }
        #expect(count == 1)
        #expect(offset == data.count)
    }
}

struct LogParsingTests {
    @Test func readsAClaudeAssistantLine() throws {
        let line = #"{"type":"assistant","requestId":"req_1","timestamp":"2026-10-22T13:41:22.969Z","message":{"id":"msg_1","model":"claude-opus-5-5","usage":{"input_tokens":2,"cache_creation_input_tokens":70689,"cache_read_input_tokens":18010,"output_tokens":1021}}}"#
        let entry = try #require(ActivityScanner.readClaudeLine(Data(line.utf8)))
        #expect(entry.key == "msg_1:req_1")
        #expect(entry.model == "claude-opus-5-5")
        #expect(entry.tokens == Tokens(input: 2, cacheRead: 18010, cacheWrite: 70689, output: 1021))
    }

    @Test func ignoresSyntheticMessages() {
        let line = #"{"type":"assistant","timestamp":"2026-10-22T13:41:22.969Z","message":{"model":"<synthetic>","usage":{"input_tokens":0}}}"#
        #expect(ActivityScanner.readClaudeLine(Data(line.utf8)) == nil)
    }

    @Test func readsCodexRateLimits() throws {
        let line = #"{"timestamp":"2026-10-22T15:07:40.511Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":65.0,"window_minutes":300,"resets_at":1792693592},"secondary":{"used_percent":82.0,"window_minutes":10080,"resets_at":1793100281},"plan_type":"plus","rate_limit_reached_type":null}}}"#
        let usage = try #require(CodexSessionLog.parse(Data(line.utf8)))
        #expect(usage.plan == "plus")
        #expect(usage.session?.percent == 65)
        #expect(usage.session?.length == 18000)
        #expect(usage.week?.resetsAt == Date(timeIntervalSince1970: 1793100281))
        #expect(!usage.limitReached)
        #expect(usage.source == .sessionLog)
    }
}

struct FormatTests {
    @Test func countdownKeepsTwoUnits() {
        let now = Date(timeIntervalSince1970: 0)
        #expect(Format.countdown(to: Date(timeIntervalSince1970: 2 * 3600 + 14 * 60), from: now) == "2h 14m")
        #expect(Format.countdown(to: Date(timeIntervalSince1970: 3 * 86400 + 4 * 3600 + 59), from: now) == "3d 4h")
        #expect(Format.countdown(to: Date(timeIntervalSince1970: 30), from: now) == "now")
    }

    @Test func tokensAbbreviate() {
        #expect(Format.tokens(950) == "950")
        #expect(Format.tokens(43_390_562) == "43M")
        #expect(Format.tokens(1_260_000) == "1.3M")
    }

    @Test func modelDropsTheProvider() {
        #expect(Format.model("anthropic/claude-haiku-4.5") == "claude-haiku-4.5")
    }
}
