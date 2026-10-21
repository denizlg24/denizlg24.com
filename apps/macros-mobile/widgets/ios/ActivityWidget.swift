import SwiftUI
import WidgetKit

/// Daily movement totals already reconciled by the app. They are context,
/// never an extra calorie allowance or a second expenditure estimate.
struct ActivityWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: SnapshotEntry

  private var steps: String {
    entry.snapshot?.activity?.steps.map(Figure.integer) ?? "—"
  }

  private var activeEnergy: String {
    guard let activity = entry.snapshot?.activity, let value = activity.activeEnergy else { return "—" }
    return "\(Figure.integer(value)) \(activity.unit)"
  }

  var body: some View {
    Group {
      switch family {
      case .accessoryInline:
        Label("\(steps) steps", systemImage: "figure.walk")
      case .accessoryCircular:
        VStack(spacing: 1) {
          Image(systemName: "figure.walk")
          Text(steps).font(.figure(16)).minimumScaleFactor(0.5).lineLimit(1)
          Text("steps").font(.caption2)
        }
      case .accessoryRectangular:
        VStack(alignment: .leading, spacing: 2) {
          Label("\(steps) steps", systemImage: "figure.walk").font(.headline).minimumScaleFactor(0.6).lineLimit(1)
          Text("\(activeEnergy) active").font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
      case .systemMedium:
        VStack(alignment: .leading, spacing: 12) {
          Label("Activity today", systemImage: "figure.walk").font(.subheadline)
          HStack(alignment: .firstTextBaseline, spacing: 24) {
            metric(value: steps, label: "steps")
            metric(value: activeEnergy, label: "active energy")
          }
          status
        }
      default:
        VStack(alignment: .leading, spacing: 5) {
          Label("Activity", systemImage: "figure.walk").font(.subheadline)
          Spacer(minLength: 0)
          Text(steps).font(.figure(30)).minimumScaleFactor(0.5).lineLimit(1)
          Text("steps").font(.caption).foregroundStyle(.secondary)
          Spacer(minLength: 0)
          Text("\(activeEnergy) active").font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
      }
    }
    .widgetBackground()
    .widgetURL(AppLink.activity)
    .accessibilityElement(children: .combine)
  }

  private func metric(value: String, label: String) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(value).font(.figure(26)).minimumScaleFactor(0.5).lineLimit(1)
      Text(label).font(.caption).foregroundStyle(.secondary)
    }.frame(maxWidth: .infinity, alignment: .leading)
  }

  @ViewBuilder private var status: some View {
    if let snapshot = entry.snapshot, snapshot.activity != nil {
      Text("Updated when Macros syncs").font(.caption2).foregroundStyle(.secondary)
    } else {
      Text("Open Macros to sync activity").font(.caption2).foregroundStyle(.secondary)
    }
  }
}

struct ActivityWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "MacrosActivity", provider: SnapshotProvider()) { entry in
      ActivityWidgetView(entry: entry)
    }
    .configurationDisplayName("Activity")
    .description("Today's steps and active energy, synced from Macros.")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryInline, .accessoryCircular, .accessoryRectangular])
  }
}
