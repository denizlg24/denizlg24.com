import AppIntents
import SwiftUI
import WidgetKit

/// The Home Screen quick actions in app.config.ts, as widgets. They only open
/// a route, so they need no App Group and ship in every build.
enum LogAction: String, AppEnum, CaseIterable {
  case search
  case scan
  case quickAdd
  case weighIn

  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Action"
  static let caseDisplayRepresentations: [LogAction: DisplayRepresentation] = [
    .search: "Log Food",
    .scan: "Scan Barcode",
    .quickAdd: "Quick Add",
    .weighIn: "Log Weight",
  ]

  var title: String {
    switch self {
    case .search: "Log Food"
    case .scan: "Scan"
    case .quickAdd: "Quick Add"
    case .weighIn: "Weigh In"
    }
  }

  var symbol: String {
    switch self {
    case .search: "magnifyingglass"
    case .scan: "barcode.viewfinder"
    case .quickAdd: "bolt"
    case .weighIn: "scalemass"
    }
  }

  var url: URL {
    switch self {
    case .search: AppLink.search
    case .scan: AppLink.scan
    case .quickAdd: AppLink.quickAdd
    case .weighIn: AppLink.weighIn
    }
  }
}

private struct StaticEntry: TimelineEntry {
  let date: Date
}

private struct StaticProvider: TimelineProvider {
  func placeholder(in context: Context) -> StaticEntry { StaticEntry(date: .now) }

  func getSnapshot(in context: Context, completion: @escaping (StaticEntry) -> Void) {
    completion(StaticEntry(date: .now))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<StaticEntry>) -> Void) {
    completion(Timeline(entries: [StaticEntry(date: .now)], policy: .never))
  }
}

private struct ActionTile: View {
  let action: LogAction

  var body: some View {
    Link(destination: action.url) {
      VStack(spacing: 4) {
        Image(systemName: action.symbol)
          .font(.system(size: 18, weight: .medium))
        Text(action.title)
          .font(.caption2.weight(.medium))
          .lineLimit(1)
          .minimumScaleFactor(0.8)
      }
      .foregroundStyle(.primary)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(
        Color(uiColor: .tertiarySystemFill),
        in: RoundedRectangle(cornerRadius: 14, style: .continuous)
      )
    }
  }
}

private struct QuickLogView: View {
  @Environment(\.widgetFamily) private var family

  var body: some View {
    Group {
      if family == .systemMedium {
        HStack(spacing: 8) {
          ForEach(LogAction.allCases, id: \.self) { ActionTile(action: $0) }
        }
      } else {
        Grid(horizontalSpacing: 8, verticalSpacing: 8) {
          GridRow {
            ActionTile(action: .search)
            ActionTile(action: .scan)
          }
          GridRow {
            ActionTile(action: .quickAdd)
            ActionTile(action: .weighIn)
          }
        }
      }
    }
    .padding(12)
    .widgetBackground()
  }
}

struct QuickLogWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "MacrosQuickLog", provider: StaticProvider()) { _ in
      QuickLogView()
    }
    .configurationDisplayName("Quick Log")
    .description("Log food, scan a barcode, quick add or weigh in.")
    .supportedFamilies([.systemSmall, .systemMedium])
    .contentMarginsDisabled()
    .containerBackgroundRemovable(false)
  }
}

struct ShortcutIntent: WidgetConfigurationIntent {
  static let title: LocalizedStringResource = "Shortcut"
  static let description = IntentDescription("Choose what the shortcut opens.")

  @Parameter(title: "Action", default: .search)
  var action: LogAction
}

private struct ShortcutEntry: TimelineEntry {
  let date: Date
  let action: LogAction
}

private struct ShortcutProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> ShortcutEntry {
    ShortcutEntry(date: .now, action: .search)
  }

  func snapshot(for configuration: ShortcutIntent, in context: Context) async -> ShortcutEntry {
    ShortcutEntry(date: .now, action: configuration.action)
  }

  func timeline(for configuration: ShortcutIntent, in context: Context) async -> Timeline<ShortcutEntry> {
    Timeline(entries: [ShortcutEntry(date: .now, action: configuration.action)], policy: .never)
  }
}

private struct ShortcutView: View {
  let entry: ShortcutEntry

  var body: some View {
    ZStack {
      AccessoryWidgetBackground()
      Image(systemName: entry.action.symbol)
        .font(.system(size: 22, weight: .medium))
    }
    .widgetURL(entry.action.url)
    .accessibilityLabel(entry.action.title)
    .widgetBackground()
  }
}

/// One action on the Lock Screen; edit the widget to pick which.
struct ShortcutWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: "MacrosShortcut", intent: ShortcutIntent.self, provider: ShortcutProvider()) {
      ShortcutView(entry: $0)
    }
    .configurationDisplayName("Shortcut")
    .description("Log food, scan, quick add or weigh in from the Lock Screen.")
    .supportedFamilies([.accessoryCircular])
  }
}
