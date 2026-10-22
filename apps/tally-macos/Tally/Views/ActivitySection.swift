import Charts
import SwiftUI

struct ActivitySection: View {
    let model: AppModel

    private var summary: ActivitySummary { model.activity.summary }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionHeader("Local tokens · \(ActivityScanner.days) days") {
                HStack(spacing: 8) {
                    if model.activity.isScanning { ProgressView().controlSize(.mini) }
                    if let at = summary.scannedAt { Text("Scanned \(Format.ago(at))") }
                }
            }
            HStack(alignment: .top, spacing: 36) {
                ForEach(Tool.allCases, id: \.self) { tool in
                    let today = summary.today[tool] ?? Tokens()
                    Figure(
                        label: "\(tool.title) today",
                        value: Format.tokens(today.total),
                        detail: "\(Format.tokens(today.output)) out · \(Format.tokens(today.cacheRead)) cached"
                    )
                }
                Spacer()
            }
            chart
            HStack(alignment: .top, spacing: 36) {
                models
                if summary.seats.count > 0 { seats }
            }
        }
    }

    private var chart: some View {
        Chart(summary.days) { day in
            BarMark(
                x: .value("Day", day.day, unit: .day),
                y: .value("Tokens", day.tokens.total)
            )
            .foregroundStyle(by: .value("Tool", day.tool.title))
            .cornerRadius(2)
        }
        .chartForegroundStyleScale([
            Tool.claude.title: Color(red: 0.85, green: 0.47, blue: 0.34),
            Tool.codex.title: Color.primary.opacity(0.55),
        ])
        .chartYAxis {
            AxisMarks { value in
                AxisGridLine().foregroundStyle(.quaternary)
                AxisValueLabel {
                    if let tokens = value.as(Int.self) { Text(Format.tokens(tokens)) }
                }
            }
        }
        .chartXAxis {
            AxisMarks(values: .stride(by: .day, count: 2)) {
                AxisValueLabel(format: .dateTime.day().month(.abbreviated))
            }
        }
        .chartLegend(position: .top, alignment: .leading)
        .frame(height: 170)
    }

    private var models: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Model").frame(maxWidth: .infinity, alignment: .leading)
                Text("Input").frame(width: 64, alignment: .trailing)
                Text("Cached").frame(width: 64, alignment: .trailing)
                Text("Written").frame(width: 64, alignment: .trailing)
                Text("Output").frame(width: 64, alignment: .trailing)
            }
            .font(.system(size: 10, weight: .medium))
            .foregroundStyle(.tertiary)
            ForEach(summary.models.prefix(8)) { row in
                HStack {
                    HStack(spacing: 6) {
                        Text(row.model).lineLimit(1)
                        Text(row.tool == .claude ? "CC" : "CX")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundStyle(.tertiary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Text(Format.tokens(row.tokens.input)).frame(width: 64, alignment: .trailing)
                    Text(Format.tokens(row.tokens.cacheRead)).frame(width: 64, alignment: .trailing)
                    Text(Format.tokens(row.tokens.cacheWrite)).frame(width: 64, alignment: .trailing)
                    Text(Format.tokens(row.tokens.output)).frame(width: 64, alignment: .trailing)
                }
                .font(.system(size: 12))
                .monospacedDigit()
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var seats: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Claude by seat")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.tertiary)
            ForEach(summary.seats) { row in
                HStack {
                    Text(title(row.seatID)).lineLimit(1)
                    Spacer()
                    Text(Format.tokens(row.tokens.total)).monospacedDigit()
                }
                .font(.system(size: 12))
            }
        }
        .frame(width: 220)
    }

    private func title(_ seatID: String?) -> String {
        guard let seatID else { return "Before Tally" }
        return model.claude.seats.first { $0.id == seatID }?.title ?? "Forgotten seat"
    }
}
