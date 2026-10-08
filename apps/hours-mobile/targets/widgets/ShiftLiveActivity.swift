import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

/// The open shift on the Lock Screen and in the Dynamic Island, with the two
/// actions a shift needs without unlocking: a break and checking out.
struct ShiftLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: ShiftAttributes.self) { context in
      LockScreenShift(attributes: context.attributes, state: context.state)
        .padding(16)
        .activityBackgroundTint(nil)
        .widgetURL(URL(string: "hours://"))
    } dynamicIsland: { context in
      let state = context.state
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          VStack(alignment: .leading, spacing: 2) {
            Eyebrow(text: label(state))
            Text(context.attributes.jobName)
              .font(.system(size: 13))
              .foregroundStyle(.secondary)
              .lineLimit(1)
          }
          .padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          WorkedTime(state: state, size: 26)
            .padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.bottom) {
          ShiftActions(state: state)
            .padding(.top, 6)
        }
      } compactLeading: {
        Image(systemName: state.status == "break" ? "cup.and.saucer.fill" : "clock.fill")
          .foregroundStyle(state.status == "break" ? .orange : .green)
      } compactTrailing: {
        WorkedTime(state: state, size: 14)
          .frame(maxWidth: 64)
      } minimal: {
        Image(systemName: state.status == "break" ? "cup.and.saucer.fill" : "clock.fill")
          .foregroundStyle(state.status == "break" ? .orange : .green)
      }
      .widgetURL(URL(string: "hours://"))
    }
  }
}

private func label(_ state: ShiftAttributes.ContentState) -> String {
  switch state.status {
  case "break":
    return "Break · " + (state.breakFromDate?.formatted(date: .omitted, time: .shortened) ?? "")
  case "ended": return "Checked out"
  default: return "Checked in"
  }
}

struct WorkedTime: View {
  let state: ShiftAttributes.ContentState
  let size: CGFloat

  var body: some View {
    Group {
      if state.status == "working" {
        Text(timerInterval: state.workedFromDate...Date.distantFuture, countsDown: false)
      } else {
        Text(Duration.seconds(state.workedSeconds), format: .time(pattern: .hourMinuteSecond))
          .foregroundStyle(state.status == "break" ? .secondary : .primary)
      }
    }
    .font(.figure(size))
    .multilineTextAlignment(.trailing)
    .lineLimit(1)
  }
}

struct ShiftActions: View {
  let state: ShiftAttributes.ContentState

  var body: some View {
    if state.status != "ended" {
      HStack(spacing: 8) {
        if state.status == "break" {
          Button(intent: ResumeShiftIntent()) {
            Label("Resume", systemImage: "arrow.uturn.forward").frame(maxWidth: .infinity)
          }
        } else {
          Button(intent: StartBreakIntent()) {
            Label("Break", systemImage: "cup.and.saucer.fill").frame(maxWidth: .infinity)
          }
        }
        Button(intent: CheckOutIntent()) {
          Label("Check out", systemImage: "stop.fill").frame(maxWidth: .infinity)
        }
      }
      .font(.system(size: 14, weight: .semibold))
      .buttonStyle(.bordered)
      .tint(.primary)
    }
  }
}

struct LockScreenShift: View {
  let attributes: ShiftAttributes
  let state: ShiftAttributes.ContentState

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline) {
        VStack(alignment: .leading, spacing: 2) {
          HStack(spacing: 6) {
            Circle()
              .fill(state.status == "break" ? Color.orange : state.status == "ended" ? .secondary : .green)
              .frame(width: 6, height: 6)
            Eyebrow(text: label(state))
          }
          Text(attributes.jobName)
            .font(.system(size: 14))
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
        Spacer()
        WorkedTime(state: state, size: 34)
      }
      if state.status == "break", let since = state.breakFromDate {
        HStack(spacing: 4) {
          Text("break")
          Text(timerInterval: since...Date.distantFuture, countsDown: false)
        }
        .font(.figure(13, weight: .regular))
        .foregroundStyle(.secondary)
      }
      ShiftActions(state: state)
    }
  }
}
