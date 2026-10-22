import SwiftUI

struct MenuBarLabel: View {
    let model: AppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        let percent = model.claude.activeSeat?.usage?.session?.effectivePercent()
        HStack(spacing: 3) {
            Image(systemName: "gauge.with.dots.needle.33percent")
            if let percent {
                Text(Format.percent(percent))
                    .monospacedDigit()
            }
        }
        .onAppear {
            model.windowOpener = { openWindow(id: $0) }
        }
    }
}

struct MenuBarView: View {
    let model: AppModel
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            claude
            Divider()
            codex
            if model.site.status == .signedIn, let usage = model.site.usage {
                Divider()
                site(usage)
            }
            Divider()
            footer
        }
        .padding(14)
        .frame(width: 330)
    }

    private var claude: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Claude").font(.system(size: 12, weight: .semibold))
                Spacer()
                if model.claude.isSwitching || model.claude.isRefreshing {
                    ProgressView().controlSize(.mini)
                }
                Button {
                    Task { await model.refreshAll() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                .help("Refresh")
            }
            if model.claude.seats.isEmpty {
                Text("–").foregroundStyle(.tertiary)
            }
            ForEach(model.claude.seats) { seat in
                SeatMenuRow(
                    seat: seat,
                    isActive: seat.id == model.claude.activeSeatID,
                    isBusy: model.claude.isSwitching
                ) {
                    Task { await model.switchSeat(to: seat.id) }
                }
            }
            IssueText(text: model.switchError ?? model.claude.credentialIssue)
        }
    }

    private var codex: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text("Codex").font(.system(size: 12, weight: .semibold))
                if let plan = model.codex.usage?.plan {
                    Text(plan).font(.system(size: 11)).foregroundStyle(.secondary)
                }
                Spacer()
                if model.codex.usage?.source == .sessionLog, let at = model.codex.usage?.fetchedAt {
                    Text("log · \(Format.ago(at))").font(.system(size: 10)).foregroundStyle(.tertiary)
                }
            }
            WindowReadout(label: "5h", window: model.codex.usage?.session)
            WindowReadout(label: "7d", window: model.codex.usage?.week)
        }
    }

    private func site(_ usage: SiteUsage) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text("denizlg24").font(.system(size: 12, weight: .semibold))
            Spacer()
            ForEach([("24h", usage.last24h), ("7d", usage.last7d), ("30d", usage.last30d)], id: \.0) { label, period in
                HStack(spacing: 3) {
                    Text(label).foregroundStyle(.secondary)
                    Text(Format.usd(period.totalCost)).monospacedDigit()
                }
                .font(.system(size: 11))
            }
        }
    }

    private var footer: some View {
        HStack(spacing: 14) {
            Button("Open Tally") {
                model.openDashboard()
            }
            .keyboardShortcut("o")
            Button("Add Seat") {
                Task { await model.claude.addSeat() }
            }
            Spacer()
            Button {
                NSApp.activate()
                openSettings()
            } label: {
                Image(systemName: "gearshape")
            }
            .keyboardShortcut(",")
            Button {
                NSApp.terminate(nil)
            } label: {
                Image(systemName: "power")
            }
            .keyboardShortcut("q")
        }
        .buttonStyle(.borderless)
        .font(.system(size: 12))
    }
}

private struct SeatMenuRow: View {
    let seat: ClaudeSeat
    let isActive: Bool
    let isBusy: Bool
    let onSwitch: () -> Void
    @State private var hovering = false

    var body: some View {
        Button {
            if !isActive { onSwitch() }
        } label: {
            HStack(alignment: .top, spacing: 9) {
                Circle()
                    .fill(isActive ? Color.accentColor : .clear)
                    .strokeBorder(isActive ? Color.accentColor : .secondary.opacity(0.5), lineWidth: 1)
                    .frame(width: 7, height: 7)
                    .padding(.top, 4)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(seat.title)
                            .font(.system(size: 12, weight: isActive ? .semibold : .regular))
                            .lineLimit(1)
                        Spacer()
                        if seat.signedOut {
                            Text("signed out").font(.system(size: 10)).foregroundStyle(.orange)
                        } else if !isActive && hovering {
                            Text("Switch").font(.system(size: 10, weight: .medium)).foregroundStyle(Color.accentColor)
                        }
                    }
                    WindowReadout(label: "5h", window: seat.usage?.session)
                    WindowReadout(label: "7d", window: seat.usage?.week)
                }
            }
            .padding(.vertical, 5)
            .padding(.horizontal, 6)
            .contentShape(.rect)
            .background(
                RoundedRectangle(cornerRadius: 7)
                    .fill(hovering && !isActive ? Color.primary.opacity(0.06) : .clear)
            )
        }
        .buttonStyle(.plain)
        .disabled(isBusy || seat.signedOut)
        .onHover { hovering = $0 }
    }
}
