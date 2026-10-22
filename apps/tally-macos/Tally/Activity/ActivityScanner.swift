import Foundation

enum Tool: String, Codable, Sendable, CaseIterable {
    case claude
    case codex

    var title: String {
        switch self {
        case .claude: "Claude Code"
        case .codex: "Codex"
        }
    }
}

struct Tokens: Codable, Sendable, Equatable {
    var input = 0
    var cacheRead = 0
    var cacheWrite = 0
    var output = 0

    var total: Int { input + cacheRead + cacheWrite + output }

    static func += (lhs: inout Tokens, rhs: Tokens) {
        lhs.input += rhs.input
        lhs.cacheRead += rhs.cacheRead
        lhs.cacheWrite += rhs.cacheWrite
        lhs.output += rhs.output
    }
}

/// Tokens one tool spent on one model within one hour.
struct HourBucket: Codable, Sendable, Equatable {
    var hour: Date
    var tool: Tool
    var model: String
    var tokens: Tokens
}

/// How far into a log file Tally has read, and what it found there. A file
/// that has grown is read from `offset` on; one that shrank is read again.
private struct FileState: Codable {
    var offset: Int
    var size: Int
    var buckets: [String: HourBucket] = [:]
    /// Claude Code writes a message once per content block, each line carrying
    /// the whole message's usage; the copies are adjacent, so the last few
    /// keys are enough to count each message once across incremental reads.
    var recentKeys: [String] = []
    /// Codex reports a running total per session; a turn's spend is the change.
    var codexTotal: Tokens?
    var codexModel: String?
}

private struct ScanCache: Codable {
    var version = 1
    var files: [String: FileState] = [:]
}

actor ActivityScanner {
    static let days = 14
    private static let cacheName = "activity-cache.json"

    private var cache: ScanCache

    init() {
        cache = Storage.load(ScanCache.self, from: Self.cacheName) ?? ScanCache()
        if cache.version != ScanCache().version { cache = ScanCache() }
    }

    func scan(now: Date = .now) -> [HourBucket] {
        let cutoff = Calendar.current.date(byAdding: .day, value: -Self.days, to: Calendar.current.startOfDay(for: now))!
        let sources: [(Tool, URL)] = [
            (.claude, FileManager.home.appendingPathComponent(".claude/projects")),
            (.codex, CodexAPI.home.appendingPathComponent("sessions")),
        ]
        var seen = Set<String>()
        for (tool, root) in sources {
            for file in ActivityFiles.jsonl(under: root, modifiedAfter: cutoff) {
                let path = file.url.path
                seen.insert(path)
                var state = cache.files[path] ?? FileState(offset: 0, size: 0)
                if file.size < state.offset { state = FileState(offset: 0, size: 0) }
                guard file.size != state.size else { continue }
                read(file, tool: tool, into: &state)
                cache.files[path] = state
            }
        }
        cache.files = cache.files.filter { seen.contains($0.key) }
        for (path, state) in cache.files {
            cache.files[path]?.buckets = state.buckets.filter { $0.value.hour >= cutoff }
        }
        Storage.save(cache, to: Self.cacheName)
        return cache.files.values.flatMap { $0.buckets.values }
    }

    private func read(_ file: ActivityFile, tool: Tool, into state: inout FileState) {
        guard let data = try? Data(contentsOf: file.url, options: .alwaysMapped) else { return }
        let needles = tool == .claude ? ["\"usage\""] : ["\"token_count\"", "\"turn_context\""]
        state.offset = JSONLines.forEach(in: data, from: state.offset, containing: needles) { line in
            switch tool {
            case .claude: Self.readClaude(line, into: &state)
            case .codex: Self.readCodex(line, into: &state)
            }
        }
        state.size = file.size
        state.recentKeys = Array(state.recentKeys.suffix(64))
    }

    static func readClaudeLine(_ line: Data) -> (key: String?, at: Date, model: String, tokens: Tokens)? {
        guard let object = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
              object["type"] as? String == "assistant",
              let message = object["message"] as? [String: Any],
              let usage = message["usage"] as? [String: Any],
              let stamp = object["timestamp"] as? String,
              let at = ISO8601.parse(stamp)
        else { return nil }
        let model = message["model"] as? String ?? "unknown"
        guard model != "<synthetic>" else { return nil }
        func int(_ key: String) -> Int { (usage[key] as? NSNumber)?.intValue ?? 0 }
        let tokens = Tokens(
            input: int("input_tokens"),
            cacheRead: int("cache_read_input_tokens"),
            cacheWrite: int("cache_creation_input_tokens"),
            output: int("output_tokens")
        )
        let key = (message["id"] as? String).map { "\($0):\(object["requestId"] as? String ?? "")" }
        return (key, at, model, tokens)
    }

    private static func readClaude(_ line: Data, into state: inout FileState) {
        guard let entry = readClaudeLine(line), entry.tokens.total > 0 else { return }
        if let key = entry.key {
            guard !state.recentKeys.contains(key) else { return }
            state.recentKeys.append(key)
            if state.recentKeys.count > 256 { state.recentKeys.removeFirst(128) }
        }
        add(entry.tokens, tool: .claude, model: entry.model, at: entry.at, to: &state)
    }

    private static func readCodex(_ line: Data, into state: inout FileState) {
        guard let object = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
              let payload = object["payload"] as? [String: Any]
        else { return }
        switch (object["type"] as? String, payload["type"] as? String) {
        case ("turn_context", _):
            if let model = payload["model"] as? String { state.codexModel = model }
        case ("event_msg", "token_count"):
            guard let info = payload["info"] as? [String: Any],
                  let total = info["total_token_usage"] as? [String: Any],
                  let stamp = object["timestamp"] as? String,
                  let at = ISO8601.parse(stamp)
            else { return }
            func int(_ key: String) -> Int { (total[key] as? NSNumber)?.intValue ?? 0 }
            let cached = int("cached_input_tokens")
            let current = Tokens(
                input: max(int("input_tokens") - cached, 0),
                cacheRead: cached,
                cacheWrite: int("cache_write_input_tokens"),
                output: int("output_tokens")
            )
            let previous = state.codexTotal ?? Tokens()
            let delta = Tokens(
                input: max(current.input - previous.input, 0),
                cacheRead: max(current.cacheRead - previous.cacheRead, 0),
                cacheWrite: max(current.cacheWrite - previous.cacheWrite, 0),
                output: max(current.output - previous.output, 0)
            )
            state.codexTotal = current
            guard delta.total > 0 else { return }
            add(delta, tool: .codex, model: state.codexModel ?? "unknown", at: at, to: &state)
        default:
            return
        }
    }

    private static func add(_ tokens: Tokens, tool: Tool, model: String, at: Date, to state: inout FileState) {
        let hour = Date(timeIntervalSince1970: (at.timeIntervalSince1970 / 3600).rounded(.down) * 3600)
        let key = "\(Int(hour.timeIntervalSince1970))|\(model)"
        var bucket = state.buckets[key] ?? HourBucket(hour: hour, tool: tool, model: model, tokens: Tokens())
        bucket.tokens += tokens
        state.buckets[key] = bucket
    }
}
