import SwiftUI
import WidgetKit

/// Today's energy against its target, as the ring on the Today screen reads it.
private struct EnergyFigures {
  let eaten: Double
  let target: Double?
  let unit: String
  let remainingMode: Bool

  init(_ snapshot: WidgetSnapshot) {
    eaten = snapshot.energy.eaten
    target = snapshot.energy.target
    unit = snapshot.energy.unit
    remainingMode = snapshot.mode == "remaining"
  }

  var remaining: Double? { target.map { $0 - eaten } }
  var over: Bool { (remaining ?? 0) < 0 }
  var progress: Double { target.map { $0 > 0 ? eaten / $0 : 0 } ?? 0 }

  var figure: String {
    if remainingMode, let remaining { return Figure.integer(abs(remaining)) }
    return Figure.integer(eaten)
  }

  var caption: String {
    if remainingMode, remaining != nil { return over ? "\(unit) over" : "\(unit) left" }
    if let target { return "of \(Figure.integer(target))" }
    return unit
  }

  /// One line for the Lock Screen: "840 kcal left", "1,460 / 2,300 kcal".
  var line: String {
    if remainingMode, remaining != nil { return "\(figure) \(caption)" }
    if let target { return "\(Figure.integer(eaten)) / \(Figure.integer(target)) \(unit)" }
    return "\(Figure.integer(eaten)) \(unit)"
  }
}

private struct CalorieRing: View {
  let snapshot: WidgetSnapshot
  var lineWidth: CGFloat = 8
  var figureSize: CGFloat = 24

  var body: some View {
    let energy = EnergyFigures(snapshot)
    ZStack {
      Circle().stroke(.quaternary, lineWidth: lineWidth)
      Circle()
        .trim(from: 0, to: min(1, max(0, energy.progress)))
        .stroke(
          Color(hex: energy.over ? snapshot.energy.overColor : snapshot.energy.color),
          style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
        )
        .rotationEffect(.degrees(-90))
        .widgetAccentable()
      VStack(spacing: 0) {
        Text(energy.figure)
          .font(.figure(figureSize))
          .minimumScaleFactor(0.6)
          .lineLimit(1)
        Text(energy.caption)
          .font(.system(size: 11))
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
      .padding(lineWidth + 4)
    }
  }
}

private struct MacroRow: View {
  let macro: WidgetSnapshot.Macro

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      HStack(alignment: .firstTextBaseline) {
        Text(macro.label)
          .font(.caption)
          .foregroundStyle(.secondary)
        Spacer(minLength: 4)
        Text(amount)
          .font(.figure(12, weight: .medium))
          .lineLimit(1)
      }
      Meter(value: macro.eaten, target: macro.target, color: Color(hex: macro.color))
    }
  }

  private var amount: String {
    let eaten = Figure.integer(macro.eaten)
    guard let target = macro.target else { return "\(eaten) g" }
    return "\(eaten) / \(Figure.integer(target)) g"
  }
}

private struct MacroLegend: View {
  let macros: [WidgetSnapshot.Macro]

  var body: some View {
    HStack(spacing: 8) {
      ForEach(macros) { macro in
        HStack(spacing: 2) {
          Text(String(macro.label.prefix(1)))
            .foregroundStyle(Color(hex: macro.color))
          Text(Figure.integer(macro.eaten))
        }
      }
    }
    .font(.figure(12, weight: .medium))
    .lineLimit(1)
    .minimumScaleFactor(0.8)
  }
}

private struct ActionIcon: View {
  let symbol: String
  let label: String
  let url: URL

  var body: some View {
    Link(destination: url) {
      Image(systemName: symbol)
        .font(.system(size: 15, weight: .medium))
        .foregroundStyle(.primary)
        .frame(width: 30, height: 30)
        .background(Color(uiColor: .tertiarySystemFill), in: Circle())
    }
    .accessibilityLabel(label)
  }
}

struct TodayWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: SnapshotEntry

  var body: some View {
    Group {
      if let snapshot = entry.snapshot {
        content(snapshot)
      } else {
        switch family {
        case .accessoryInline: Text("Open Macros")
        case .accessoryCircular, .accessoryRectangular:
          Image(systemName: "fork.knife")
        default: OpenAppPrompt(title: "Today")
        }
      }
    }
    .widgetBackground()
  }

  @ViewBuilder
  private func content(_ snapshot: WidgetSnapshot) -> some View {
    let energy = EnergyFigures(snapshot)
    switch family {
    case .accessoryInline:
      Text(energy.line)
        .widgetURL(AppLink.log)

    case .accessoryCircular:
      Gauge(value: min(1, max(0, energy.progress))) {
        Text(snapshot.energy.unit)
      } currentValueLabel: {
        Text(energy.figure).font(.figure(13))
      }
      .gaugeStyle(.accessoryCircularCapacity)
      .widgetURL(AppLink.log)

    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 2) {
        Text(energy.line)
          .font(.figure(15))
          .lineLimit(1)
        Gauge(value: min(1, max(0, energy.progress))) { EmptyView() }
          .gaugeStyle(.accessoryLinearCapacity)
        MacroLegend(macros: snapshot.macros)
      }
      .widgetURL(AppLink.log)

    case .systemMedium:
      HStack(spacing: 16) {
        CalorieRing(snapshot: snapshot, lineWidth: 9, figureSize: 26)
          .frame(width: 118, height: 118)
        VStack(alignment: .leading, spacing: 8) {
          HStack {
            Eyebrow(text: "Today")
            Spacer(minLength: 0)
            ActionIcon(symbol: "barcode.viewfinder", label: "Scan barcode", url: AppLink.scan)
            ActionIcon(symbol: "plus", label: "Log food", url: AppLink.search)
          }
          ForEach(snapshot.macros) { MacroRow(macro: $0) }
        }
      }
      .widgetURL(AppLink.log)

    default:
      VStack(spacing: 8) {
        CalorieRing(snapshot: snapshot)
        MacroLegend(macros: snapshot.macros)
      }
      .widgetURL(AppLink.log)
    }
  }
}

struct TodayWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "MacrosToday", provider: SnapshotProvider()) { entry in
      TodayWidgetView(entry: entry)
    }
    .configurationDisplayName("Today")
    .description("Calories and macros eaten today against your targets.")
    .supportedFamilies([
      .systemSmall, .systemMedium,
      .accessoryCircular, .accessoryRectangular, .accessoryInline,
    ])
  }
}
