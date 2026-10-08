import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

@main
struct VoiceWidgetBundle: WidgetBundle {
  var body: some Widget {
    AskWidget()
    VoiceLiveActivity()
    AskControl()
  }
}

private let sage = Color(red: 0.63, green: 0.74, blue: 0.60)
private let moss = Color(red: 0.19, green: 0.21, blue: 0.19)

/// The orb as a still: the app's icon, drawn rather than shipped as an image.
struct Orb: View {
  var body: some View {
    Circle()
      .fill(
        RadialGradient(
          colors: [Color(red: 0.95, green: 0.95, blue: 0.88), sage, moss],
          center: UnitPoint(x: 0.35, y: 0.3), startRadius: 2, endRadius: 60))
      .shadow(color: sage.opacity(0.5), radius: 8)
  }
}

struct AskEntry: TimelineEntry {
  let date: Date
  let exchange: VoiceExchange?
}

struct AskProvider: TimelineProvider {
  func placeholder(in context: Context) -> AskEntry {
    AskEntry(date: Date(), exchange: nil)
  }

  func getSnapshot(in context: Context, completion: @escaping (AskEntry) -> Void) {
    completion(AskEntry(date: Date(), exchange: VoiceExchange.load()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<AskEntry>) -> Void) {
    completion(
      Timeline(entries: [AskEntry(date: Date(), exchange: VoiceExchange.load())], policy: .never))
  }
}

struct AskWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "VoiceAsk", provider: AskProvider()) { entry in
      AskWidgetView(exchange: entry.exchange)
        .containerBackground(.background, for: .widget)
        .widgetURL(URL(string: "voice://listen"))
    }
    .configurationDisplayName("Ask")
    .description("Open Voice listening; the last reply underneath.")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular])
  }
}

struct AskWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let exchange: VoiceExchange?

  var body: some View {
    switch family {
    case .accessoryCircular:
      ZStack {
        AccessoryWidgetBackground()
        Image(systemName: "waveform")
          .font(.system(size: 22, weight: .semibold))
      }
      .widgetAccentable()
    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 2) {
        Label("Ask", systemImage: "waveform")
          .font(.system(size: 13, weight: .semibold))
          .widgetAccentable()
        Text(exchange?.reply ?? "")
          .font(.system(size: 12))
          .foregroundStyle(.secondary)
          .lineLimit(2)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    case .systemMedium:
      HStack(spacing: 16) {
        Orb().frame(width: 72, height: 72)
        reply
      }
    default:
      VStack(alignment: .leading) {
        Orb().frame(width: 52, height: 52)
        Spacer(minLength: 0)
        Text("Ask").font(.system(size: 15, weight: .semibold))
        if let exchange {
          Text(exchange.reply)
            .font(.system(size: 11))
            .foregroundStyle(.secondary)
            .lineLimit(2)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  @ViewBuilder
  private var reply: some View {
    VStack(alignment: .leading, spacing: 4) {
      if let exchange {
        Text(exchange.question)
          .font(.system(size: 12, weight: .semibold))
          .lineLimit(1)
        Text(exchange.reply)
          .font(.system(size: 13))
          .foregroundStyle(.secondary)
          .lineLimit(4)
        Spacer(minLength: 0)
        Text(Date(timeIntervalSince1970: exchange.at), style: .relative)
          .font(.system(size: 10))
          .foregroundStyle(.tertiary)
      } else {
        Text("Ask").font(.system(size: 17, weight: .semibold))
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct AskControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "com.denizlg24.voice.ask") {
      ControlWidgetButton(action: AskIntent()) {
        Label("Ask", systemImage: "waveform")
      }
    }
    .displayName("Ask")
    .description("Open Voice listening.")
  }
}

private func phaseLabel(_ phase: String) -> String {
  switch phase {
  case "listening": return "Listening"
  case "thinking": return "Thinking"
  case "replying": return "Replying"
  case "error": return "Failed"
  default: return "Done"
  }
}

private func phaseSymbol(_ phase: String) -> String {
  switch phase {
  case "listening": return "waveform"
  case "thinking": return "ellipsis"
  case "replying": return "speaker.wave.2.fill"
  case "error": return "exclamationmark.circle"
  default: return "checkmark"
  }
}

struct StopButton: View {
  let phase: String

  var body: some View {
    if phase == "listening" || phase == "thinking" || phase == "replying" {
      Button(intent: StopVoiceIntent()) {
        Image(systemName: "stop.fill")
          .font(.system(size: 14, weight: .semibold))
          .frame(width: 36, height: 36)
      }
      .buttonStyle(.bordered)
      .buttonBorderShape(.circle)
      .tint(.primary)
    }
  }
}

struct VoiceLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: VoiceAttributes.self) { context in
      let state = context.state
      HStack(alignment: .center, spacing: 14) {
        Orb().frame(width: 40, height: 40)
        VStack(alignment: .leading, spacing: 3) {
          Text(phaseLabel(state.phase).uppercased())
            .font(.system(size: 10, weight: .semibold))
            .tracking(0.8)
            .foregroundStyle(.secondary)
          Text(state.text)
            .font(.system(size: 14))
            .lineLimit(3)
        }
        Spacer(minLength: 0)
        StopButton(phase: state.phase)
      }
      .padding(16)
      .widgetURL(URL(string: "voice://"))
    } dynamicIsland: { context in
      let state = context.state
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Orb().frame(width: 34, height: 34).padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          StopButton(phase: state.phase)
        }
        DynamicIslandExpandedRegion(.center) {
          Text(phaseLabel(state.phase))
            .font(.system(size: 13, weight: .semibold))
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text(state.text)
            .font(.system(size: 14))
            .foregroundStyle(.secondary)
            .lineLimit(2)
        }
      } compactLeading: {
        Orb().frame(width: 18, height: 18)
      } compactTrailing: {
        Image(systemName: phaseSymbol(state.phase))
          .symbolEffect(.variableColor.iterative, isActive: state.phase != "done")
      } minimal: {
        Orb().frame(width: 18, height: 18)
      }
      .widgetURL(URL(string: "voice://"))
    }
  }
}
