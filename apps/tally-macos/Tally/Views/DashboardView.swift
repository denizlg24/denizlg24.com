import SwiftUI

struct DashboardView: View {
    let model: AppModel

    var body: some View {
        ScrollView {
            DashboardContent(model: model)
                .frame(maxWidth: 1180)
                .frame(maxWidth: .infinity)
        }
        .frame(minWidth: 940, minHeight: 620)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                HStack(spacing: 10) {
                    if let at = model.lastRefresh {
                        Text(Format.ago(at))
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                    }
                    Button("Refresh", systemImage: "arrow.clockwise") {
                        Task { await model.refreshAll() }
                    }
                    .keyboardShortcut("r")
                }
            }
        }
        .navigationTitle("Tally")
    }
}

struct DashboardContent: View {
    let model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 34) {
            ClaudeSection(model: model)
            HStack(alignment: .top, spacing: 40) {
                CodexSection(monitor: model.codex)
                    .frame(maxWidth: .infinity)
                headroom
                    .frame(maxWidth: .infinity)
            }
            ActivitySection(model: model)
            SiteSection(monitor: model.site)
        }
        .padding(.horizontal, 32)
        .padding(.vertical, 26)
    }

    /// The seat to jump to next, stated as numbers rather than advice.
    private var headroom: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader("Headroom")
            HStack(alignment: .top, spacing: 36) {
                Figure(
                    label: "Active",
                    value: model.claude.activeSeat.map { Format.percent($0.usage?.headroom ?? 0) } ?? "–",
                    detail: model.claude.activeSeat?.title
                )
                Figure(
                    label: "Best other seat",
                    value: model.claude.bestAlternative.map { Format.percent($0.usage?.headroom ?? 0) } ?? "–",
                    detail: model.claude.bestAlternative?.title
                )
                Spacer()
            }
            if let best = model.claude.bestAlternative {
                Button("Switch to \(best.title)") {
                    Task { await model.switchSeat(to: best.id) }
                }
                .keyboardShortcut("s", modifiers: [.command, .shift])
                .disabled(model.claude.isSwitching)
            }
        }
    }
}
