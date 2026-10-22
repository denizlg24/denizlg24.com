import Charts
import SwiftUI

struct SiteSection: View {
    let monitor: SiteMonitor

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionHeader("denizlg24") {
                HStack(spacing: 8) {
                    if monitor.isRefreshing { ProgressView().controlSize(.mini) }
                    if let usage = monitor.usage { Text(Format.ago(usage.fetchedAt)) }
                }
            }
            switch monitor.status {
            case .signedOut:
                HStack(spacing: 12) {
                    Button("Sign In") { Task { await monitor.signIn() } }
                    IssueText(text: monitor.issue)
                }
            case .signingIn:
                HStack(spacing: 12) {
                    ProgressView().controlSize(.small)
                    Button("Cancel") { Task { await monitor.cancelSignIn() } }
                }
            case .signedIn:
                if let usage = monitor.usage {
                    content(usage)
                } else {
                    ProgressView().controlSize(.small)
                }
                IssueText(text: monitor.issue)
            }
        }
    }

    private func content(_ usage: SiteUsage) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 36) {
                figure("24 hours", usage.last24h)
                figure("7 days", usage.last7d)
                figure("30 days", usage.last30d)
                figure("All time", usage.allTime)
                Spacer()
            }
            Chart(usage.dailyBreakdown) { day in
                if let date = day.day {
                    BarMark(x: .value("Day", date, unit: .day), y: .value("Cost", day.cost))
                        .foregroundStyle(Color.primary.opacity(0.55))
                        .cornerRadius(2)
                }
            }
            .chartYAxis {
                AxisMarks { value in
                    AxisGridLine().foregroundStyle(.quaternary)
                    AxisValueLabel {
                        if let cost = value.as(Double.self) { Text(Format.usd(cost)) }
                    }
                }
            }
            .chartXAxis {
                AxisMarks(values: .stride(by: .day, count: 5)) {
                    AxisValueLabel(format: .dateTime.day().month(.abbreviated))
                }
            }
            .frame(height: 130)
            HStack(alignment: .top, spacing: 36) {
                breakdown("Model", usage.byModel.prefix(8), name: Format.model)
                breakdown("Source", usage.bySource.prefix(8), name: { $0 })
            }
            recent(usage.recent.prefix(12))
        }
    }

    private func figure(_ label: String, _ period: SiteUsage.Period) -> some View {
        Figure(
            label: label,
            value: Format.usd(period.totalCost),
            detail: "\(period.totalRequests.formatted()) calls · \(Format.tokens(period.totalInputTokens + period.totalOutputTokens))"
        )
    }

    private func breakdown(
        _ title: String,
        _ rows: ArraySlice<SiteUsage.Breakdown>,
        name: @escaping (String) -> String
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title).frame(maxWidth: .infinity, alignment: .leading)
                Text("Calls").frame(width: 56, alignment: .trailing)
                Text("Cost").frame(width: 64, alignment: .trailing)
            }
            .font(.system(size: 10, weight: .medium))
            .foregroundStyle(.tertiary)
            ForEach(rows) { row in
                HStack {
                    Text(name(row.name)).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                    Text(row.requests.formatted()).frame(width: 56, alignment: .trailing)
                    Text(Format.usd(row.cost)).frame(width: 64, alignment: .trailing)
                }
                .font(.system(size: 12))
                .monospacedDigit()
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func recent(_ rows: ArraySlice<SiteUsage.Request>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Recent")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.tertiary)
            ForEach(rows) { row in
                HStack(spacing: 12) {
                    Text(row.createdAt, format: .dateTime.hour().minute())
                        .foregroundStyle(.secondary)
                        .frame(width: 44, alignment: .leading)
                    Text(Format.model(row.llmModel)).lineLimit(1).frame(width: 190, alignment: .leading)
                    Text(row.source).lineLimit(1).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
                    Text("\(Format.tokens(row.inputTokens)) → \(Format.tokens(row.outputTokens))")
                        .foregroundStyle(.secondary)
                        .frame(width: 100, alignment: .trailing)
                    Text(Format.usd(row.costUsd)).frame(width: 64, alignment: .trailing)
                }
                .font(.system(size: 12))
                .monospacedDigit()
            }
        }
    }
}
