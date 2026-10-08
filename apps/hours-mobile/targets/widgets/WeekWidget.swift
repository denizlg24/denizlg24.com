import SwiftUI
import WidgetKit

struct WeekWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "HoursWeek", provider: HoursProvider()) { entry in
      WeekWidgetView(snapshot: entry.snapshot)
        .containerBackground(.background, for: .widget)
        .widgetURL(URL(string: "hours://pay"))
    }
    .configurationDisplayName("Week")
    .description("This week against its target, the month, and the next payout.")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
  }
}

struct WeekWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let snapshot: HoursSnapshot

  private var fraction: Double {
    guard let target = snapshot.weeklyTargetMinutes, target > 0 else { return 0 }
    return min(1, Double(snapshot.weekMinutes(at: Date())) / Double(target))
  }

  var body: some View {
    switch family {
    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 2) {
        Text("Week").font(.system(size: 12, weight: .semibold)).widgetAccentable()
        RunningTotal(snapshot: snapshot, baseMinutes: snapshot.weekBaseMinutes, size: 20)
        if snapshot.weeklyTargetMinutes != nil {
          ProgressView(value: fraction).tint(.primary)
        }
      }
    case .systemMedium:
      HStack(alignment: .top, spacing: 20) {
        week
        VStack(alignment: .leading, spacing: 10) {
          VStack(alignment: .leading, spacing: 1) {
            Eyebrow(text: "Month")
            RunningTotal(snapshot: snapshot, baseMinutes: snapshot.monthBaseMinutes, size: 17)
          }
          payout
        }
      }
    default:
      week
    }
  }

  private var week: some View {
    VStack(alignment: .leading, spacing: 4) {
      Eyebrow(text: "Week")
      Spacer(minLength: 0)
      RunningTotal(snapshot: snapshot, baseMinutes: snapshot.weekBaseMinutes, size: 30)
      if let target = snapshot.weeklyTargetMinutes {
        Text("of \(HoursDates.minutes(target))")
          .font(.system(size: 12))
          .foregroundStyle(.secondary)
        Capsule()
          .fill(.quaternary)
          .frame(height: 3)
          .overlay(alignment: .leading) {
            GeometryReader { proxy in
              Capsule().fill(.primary).frame(width: proxy.size.width * fraction, height: 3)
            }
          }
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  @ViewBuilder
  private var payout: some View {
    if let net = snapshot.payoutNetMinor, let currency = snapshot.payoutCurrency {
      VStack(alignment: .leading, spacing: 1) {
        Eyebrow(text: snapshot.payoutDate.map { "Pays " + $0.formatted(.dateTime.day().month()) } ?? "Payout")
        Text(Double(net) / 100, format: .currency(code: currency).precision(.fractionLength(0)))
          .font(.figure(17))
          .foregroundStyle(.green)
          .lineLimit(1)
          .minimumScaleFactor(0.6)
      }
    }
  }
}
