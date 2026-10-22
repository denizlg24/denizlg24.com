import AppKit
import Foundation
import Observation

@MainActor
@Observable
final class AppModel {
    static let shared = AppModel()

    let claude = ClaudeSeats()
    let codex = CodexMonitor()
    let site = SiteMonitor()
    let activity = ActivityMonitor()
    let alerts = UsageAlerts()

    private(set) var lastRefresh: Date?
    private(set) var switchError: String?

    @ObservationIgnored private var loops: [Task<Void, Never>] = []
    /// SwiftUI's `openWindow`, handed over by the menu bar label, which is the
    /// one view alive for the app's whole life.
    @ObservationIgnored var windowOpener: ((String) -> Void)?

    private init() {}

    var refreshInterval: TimeInterval {
        let stored = UserDefaults.standard.double(forKey: "refreshInterval")
        return stored > 0 ? stored : 180
    }

    func start() {
        guard loops.isEmpty else { return }
        alerts.start()
        loops = [
            Task { await refreshAll() },
            repeating(every: { 30 }) { [unowned self] in
                let known = claude.seats.count
                await claude.sync()
                if claude.seats.count != known { await claude.refreshUsage() }
            },
            repeating(every: { [unowned self] in refreshInterval }) { [unowned self] in await refreshUsage() },
            repeating(every: { 300 }) { [unowned self] in await refreshActivity() },
        ]
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didWakeNotification, object: nil, queue: .main
        ) { _ in
            Task { @MainActor in await AppModel.shared.refreshAll() }
        }
    }

    func openDashboard() {
        NSApp.activate()
        windowOpener?("dashboard")
    }

    func refreshAll() async {
        await claude.sync()
        async let usage: Void = refreshUsage()
        async let activity: Void = refreshActivity()
        _ = await (usage, activity)
    }

    func refreshUsage() async {
        async let claude: Void = claude.refreshUsage()
        async let codex: Void = codex.refresh()
        async let site: Void = site.refresh()
        _ = await (claude, codex, site)
        lastRefresh = .now
        alerts.evaluate(model: self)
    }

    func refreshActivity() async {
        await activity.refresh { [claude] date in claude.seatID(at: date) }
    }

    func switchSeat(to seatID: String) async {
        switchError = nil
        do {
            try await claude.switchTo(seatID)
            await claude.refreshUsage()
        } catch {
            switchError = error.localizedDescription
        }
    }

    /// The seat with the most headroom, for a one-keystroke escape from a limit.
    func switchToBestSeat() async {
        guard let best = claude.bestAlternative else { return }
        await switchSeat(to: best.id)
    }

    /// Runs `body` every `interval`, starting one interval from now; the first
    /// pass is `refreshAll`, which orders sync before the reads that need it.
    private func repeating(
        every interval: @escaping @MainActor () -> TimeInterval,
        _ body: @escaping @MainActor () async -> Void
    ) -> Task<Void, Never> {
        Task { @MainActor in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(interval()))
                await body()
            }
        }
    }
}
