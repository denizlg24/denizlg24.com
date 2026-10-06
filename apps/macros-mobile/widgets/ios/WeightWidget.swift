import SwiftUI
import WidgetKit

private struct Sparkline: View {
  let points: [Double]

  var body: some View {
    GeometryReader { proxy in
      let inset: CGFloat = 3
      let low = points.min() ?? 0
      let high = points.max() ?? 0
      let span = max(high - low, 0.1)
      let width = proxy.size.width - inset * 2
      let height = proxy.size.height - inset * 2
      let step = points.count > 1 ? width / CGFloat(points.count - 1) : 0
      let position = { (index: Int, value: Double) in
        CGPoint(
          x: inset + CGFloat(index) * step,
          y: inset + height * (1 - CGFloat((value - low) / span))
        )
      }
      Path { path in
        for (index, value) in points.enumerated() {
          let point = position(index, value)
          if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
        }
      }
      .stroke(.primary, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
      .widgetAccentable()
      if let last = points.last {
        Circle()
          .fill(.primary)
          .frame(width: 6, height: 6)
          .position(position(points.count - 1, last))
      }
    }
  }
}

private struct WeightFigures {
  let weight: WidgetSnapshot.Weight

  var value: String { Figure.decimal(weight.value) }

  var change: String? {
    guard let change = weight.change, weight.changeDays > 0 else { return nil }
    return "\(Figure.signed(change)) \(weight.unit) · \(weight.changeDays) d"
  }
}

private struct WeightHeadline: View {
  let weight: WidgetSnapshot.Weight
  var size: CGFloat = 28

  var body: some View {
    let figures = WeightFigures(weight: weight)
    VStack(alignment: .leading, spacing: 2) {
      Eyebrow(text: weight.label)
      HStack(alignment: .firstTextBaseline, spacing: 3) {
        Text(figures.value).font(.figure(size))
        Text(weight.unit).font(.footnote).foregroundStyle(.secondary)
      }
      .lineLimit(1)
      .minimumScaleFactor(0.7)
      if let change = figures.change {
        Text(change)
          .font(.figure(12, weight: .regular))
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
    }
  }
}

private struct WeighInButton: View {
  var body: some View {
    Link(destination: AppLink.weighIn) {
      Label("Weigh in", systemImage: "scalemass")
        .font(.caption.weight(.medium))
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .foregroundStyle(.primary)
        .background(Color(uiColor: .tertiarySystemFill), in: Capsule())
    }
  }
}

struct WeightWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: SnapshotEntry

  var body: some View {
    Group {
      if let snapshot = entry.snapshot {
        if let weight = snapshot.weight {
          content(weight, weighedToday: snapshot.weighedToday)
        } else {
          empty
        }
      } else {
        switch family {
        case .accessoryInline: Text("Open Macros")
        case .accessoryRectangular: Image(systemName: "scalemass")
        default: OpenAppPrompt(title: "Weight")
        }
      }
    }
    .widgetBackground()
  }

  @ViewBuilder
  private var empty: some View {
    switch family {
    case .accessoryInline:
      Text("Weigh in").widgetURL(AppLink.weighIn)
    case .accessoryRectangular:
      Label("Weigh in", systemImage: "scalemass").widgetURL(AppLink.weighIn)
    default:
      VStack(alignment: .leading, spacing: 6) {
        Eyebrow(text: "Weight")
        Spacer(minLength: 0)
        Text("Weigh in a few mornings a week to see your trend.")
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      .widgetURL(AppLink.weighIn)
    }
  }

  @ViewBuilder
  private func content(_ weight: WidgetSnapshot.Weight, weighedToday: Bool) -> some View {
    let figures = WeightFigures(weight: weight)
    switch family {
    case .accessoryInline:
      Text("\(figures.value) \(weight.unit) \(weight.label.lowercased())")
        .widgetURL(AppLink.progress)

    case .accessoryRectangular:
      HStack(spacing: 8) {
        VStack(alignment: .leading, spacing: 0) {
          Text("\(figures.value) \(weight.unit)").font(.figure(15))
          if let change = figures.change {
            Text(change).font(.figure(12, weight: .regular))
          }
        }
        .lineLimit(1)
        if weight.points.count > 1 {
          Sparkline(points: weight.points).padding(.vertical, 4)
        }
      }
      .widgetURL(AppLink.progress)

    case .systemMedium:
      HStack(alignment: .top, spacing: 16) {
        VStack(alignment: .leading, spacing: 0) {
          WeightHeadline(weight: weight, size: 32)
          Spacer(minLength: 8)
          if !weighedToday { WeighInButton() }
        }
        if weight.points.count > 1 {
          Sparkline(points: weight.points).padding(.vertical, 8)
        }
      }
      .widgetURL(AppLink.progress)

    default:
      VStack(alignment: .leading, spacing: 8) {
        WeightHeadline(weight: weight)
        if weight.points.count > 1 {
          Sparkline(points: weight.points)
        } else {
          Spacer(minLength: 0)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .widgetURL(weighedToday ? AppLink.progress : AppLink.weighIn)
    }
  }
}

struct WeightWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "MacrosWeight", provider: SnapshotProvider()) { entry in
      WeightWidgetView(entry: entry)
    }
    .configurationDisplayName("Weight Trend")
    .description("Your trend weight and how it moved over the last month.")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
  }
}
