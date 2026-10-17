import AppIntents
import SwiftUI
import WidgetKit

struct ExploreEntry: TimelineEntry {
  let date: Date
  let snapshot: ExploreSnapshot
}

/// Drawn from the App Group; the app reloads it on every switch and every
/// couple of minutes while exploring, and the elapsed time ticks on its own.
struct ExploreProvider: TimelineProvider {
  func placeholder(in context: Context) -> ExploreEntry {
    ExploreEntry(date: Date(), snapshot: .empty)
  }

  func getSnapshot(in context: Context, completion: @escaping (ExploreEntry) -> Void) {
    completion(ExploreEntry(date: Date(), snapshot: ExploreStore.read()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<ExploreEntry>) -> Void) {
    completion(
      Timeline(entries: [ExploreEntry(date: Date(), snapshot: ExploreStore.read())], policy: .never))
  }
}

struct ExploreWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "LocationExplore", provider: ExploreProvider()) { entry in
      ExploreWidgetView(snapshot: entry.snapshot)
        .foregroundStyle(Color.themeLabel)
        .containerBackground(Color.themeBackground, for: .widget)
        .widgetURL(URL(string: "location:///"))
    }
    .configurationDisplayName("Explore")
    .description("Start and stop the trail.")
    .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular])
  }
}

struct ExploreWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let snapshot: ExploreSnapshot

  var body: some View {
    switch family {
    case .accessoryCircular:
      Button(intent: ToggleExploringIntent()) {
        ZStack {
          AccessoryWidgetBackground()
          Image(systemName: snapshot.exploring ? "figure.walk.motion" : "figure.stand")
            .font(.system(size: 20, weight: .semibold))
        }
      }
      .buttonStyle(.plain)
    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 2) {
        Text(snapshot.exploring ? "Exploring" : "Explore off")
          .font(.system(size: 13, weight: .semibold))
          .widgetAccentable()
        if snapshot.exploring, let startedAt = snapshot.startedAt {
          Text(startedAt, style: .timer).font(.figure(15))
        }
        Text(ExploreFormat.distance(snapshot.distanceMetres))
          .font(.figure(12, weight: .regular))
          .foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    default:
      small
    }
  }

  private var small: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 5) {
        Circle()
          .fill(snapshot.exploring ? Color.themeAccent : Color.themeSecondary.opacity(0.5))
          .frame(width: 7, height: 7)
        Eyebrow(text: snapshot.exploring ? "Exploring" : "Off")
      }
      Spacer(minLength: 0)
      if snapshot.exploring, let startedAt = snapshot.startedAt {
        Text(startedAt, style: .timer).font(.figure(26))
      } else {
        Text(ExploreFormat.distance(snapshot.distanceMetres)).font(.figure(26))
      }
      Text(
        snapshot.exploring
          ? ExploreFormat.distance(snapshot.distanceMetres) : "last walk"
      )
      .font(.figure(12, weight: .regular))
      .foregroundStyle(.secondary)
      Spacer(minLength: 0)
      Button(intent: ToggleExploringIntent()) {
        Label(
          snapshot.exploring ? "Stop" : "Explore",
          systemImage: snapshot.exploring ? "stop.fill" : "figure.walk"
        )
        .font(.system(size: 13, weight: .semibold))
        .frame(maxWidth: .infinity)
        .padding(.vertical, 7)
        .foregroundStyle(Color.themeOnTint)
        .background(Color.themeTint, in: Capsule())
      }
      .buttonStyle(.plain)
    }
  }
}

/// Control Center, the Lock Screen's bottom corners and the Action Button.
struct ExploreControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "com.denizlg24.location.explore", provider: ExploreValueProvider()) {
      exploring in
      ControlWidgetToggle("Explore", isOn: exploring, action: SetExploringIntent()) { on in
        Label(on ? "Exploring" : "Off", systemImage: on ? "figure.walk.motion" : "figure.stand")
      }
      .tint(Color.themeAccent)
    }
    .displayName("Explore")
    .description("Record the trail while on.")
  }
}

struct ExploreValueProvider: ControlValueProvider {
  var previewValue: Bool { false }

  func currentValue() async throws -> Bool {
    ExploreStore.read().exploring
  }
}
