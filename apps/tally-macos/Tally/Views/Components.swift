import SwiftUI

extension UsageLevel {
    var color: Color {
        switch self {
        case .calm: Color.primary.opacity(0.62)
        case .warm: .orange
        case .hot: .red
        }
    }
}

/// A usage bar with a tick at how far through its window time is. Fill past
/// the tick is spend running ahead of the clock.
struct Meter: View {
    let window: UsageWindow?
    var height: CGFloat = 4

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            GeometryReader { proxy in
                let percent = window?.effectivePercent(at: context.date) ?? 0
                ZStack(alignment: .leading) {
                    Capsule().fill(.quaternary)
                    Capsule()
                        .fill(UsageLevel(percent).color)
                        .frame(width: max(proxy.size.width * percent / 100, percent > 0 ? height : 0))
                    if let elapsed = elapsed(at: context.date) {
                        Rectangle()
                            .fill(.primary.opacity(0.5))
                            .frame(width: 1, height: height + 4)
                            .offset(x: proxy.size.width * elapsed - 0.5)
                    }
                }
                .frame(height: height)
                .frame(maxHeight: .infinity)
            }
        }
        .frame(height: height + 4)
        .animation(.smooth, value: window?.percent)
    }

    private func elapsed(at now: Date) -> Double? {
        guard let window, let resetsAt = window.resetsAt, let length = window.length,
              length > 0, resetsAt > now
        else { return nil }
        return min(max(1 - resetsAt.timeIntervalSince(now) / length, 0), 1)
    }
}

/// `5h ━━━━━──── 62%  2h 14m`
struct WindowReadout: View {
    let label: String
    let window: UsageWindow?
    var meterWidth: CGFloat? = nil

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            HStack(spacing: 8) {
                Text(label)
                    .foregroundStyle(.secondary)
                    .frame(width: 20, alignment: .leading)
                Meter(window: window)
                    .frame(width: meterWidth)
                Text(window.map { Format.percent($0.effectivePercent(at: context.date)) } ?? "–")
                    .monospacedDigit()
                    .frame(width: 34, alignment: .trailing)
                Text(reset(at: context.date))
                    .foregroundStyle(.tertiary)
                    .monospacedDigit()
                    .frame(width: 48, alignment: .trailing)
            }
            .font(.system(size: 11))
        }
    }

    private func reset(at now: Date) -> String {
        guard let window, let resetsAt = window.resetsAt else { return "" }
        return window.hasReset(at: now) ? "reset" : Format.countdown(to: resetsAt, from: now)
    }
}

struct SectionHeader<Trailing: View>: View {
    let title: String
    @ViewBuilder var trailing: Trailing

    init(_ title: String, @ViewBuilder trailing: () -> Trailing = { EmptyView() }) {
        self.title = title
        self.trailing = trailing()
    }

    var body: some View {
        VStack(spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(title.uppercased())
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(0.9)
                    .foregroundStyle(.secondary)
                Spacer()
                trailing
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
            Divider()
        }
    }
}

struct Figure: View {
    let label: String
    let value: String
    var detail: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: 22, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .contentTransition(.numericText())
            if let detail {
                Text(detail)
                    .font(.system(size: 11))
                    .foregroundStyle(.tertiary)
                    .monospacedDigit()
            }
        }
    }
}

struct IssueText: View {
    let text: String?

    var body: some View {
        if let text {
            Label(text, systemImage: "exclamationmark.triangle")
                .font(.system(size: 11))
                .foregroundStyle(.orange)
                .lineLimit(2)
        }
    }
}
