import AppIntents
import SwiftUI
import WidgetKit

/// The app's look: monochrome, figures in SF Pro Rounded with tabular digits,
/// one status dot carrying the only colour.
extension Font {
  static func figure(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
    .system(size: size, weight: weight, design: .rounded).monospacedDigit()
  }
}

struct StatusDot: View {
  let status: ShiftStatus

  var body: some View {
    Circle()
      .fill(color)
      .frame(width: 6, height: 6)
  }

  private var color: Color {
    switch status {
    case .working: return .green
    case .onBreak: return .orange
    case .off: return .secondary.opacity(0.5)
    }
  }
}

struct Eyebrow: View {
  let text: String

  var body: some View {
    Text(text.uppercased())
      .font(.system(size: 10, weight: .semibold))
      .tracking(0.8)
      .foregroundStyle(.secondary)
      .lineLimit(1)
  }
}

func statusLabel(_ snapshot: HoursSnapshot) -> String {
  switch snapshot.status {
  case .off: return "Off"
  case .working:
    return "In · " + (snapshot.shiftStart?.formatted(date: .omitted, time: .shortened) ?? "")
  case .onBreak:
    return "Break · " + (snapshot.breakFrom?.formatted(date: .omitted, time: .shortened) ?? "")
  }
}

/// Worked time on the open shift: a live count-up while working, frozen on a
/// break, today's total when off.
struct ShiftClock: View {
  let snapshot: HoursSnapshot
  let size: CGFloat

  var body: some View {
    Group {
      switch snapshot.status {
      case .working:
        if let from = snapshot.workedFrom {
          Text(timerInterval: from...Date.distantFuture, countsDown: false)
        }
      case .onBreak:
        Text(Duration.seconds(snapshot.workedSeconds), format: .time(pattern: .hourMinuteSecond))
          .foregroundStyle(.secondary)
      case .off:
        Text(HoursDates.minutes(snapshot.todayBaseMinutes))
      }
    }
    .font(.figure(size))
    .lineLimit(1)
    .minimumScaleFactor(0.6)
  }
}

/// A total that keeps counting while a shift runs: base minutes + the timer.
struct RunningTotal: View {
  let snapshot: HoursSnapshot
  let baseMinutes: Int
  let size: CGFloat

  var body: some View {
    Group {
      if snapshot.status == .working, let from = snapshot.workedFrom {
        Text(
          timerInterval: from.addingTimeInterval(-Double(baseMinutes * 60))...Date.distantFuture,
          countsDown: false, showsHours: true)
      } else {
        Text(HoursDates.minutes(baseMinutes + (snapshot.status == .onBreak ? snapshot.workedSeconds / 60 : 0)))
      }
    }
    .font(.figure(size))
    .lineLimit(1)
    .minimumScaleFactor(0.6)
  }
}

struct ShiftButton: View {
  let snapshot: HoursSnapshot

  var body: some View {
    if snapshot.status == .off {
      Button(intent: CheckInIntent()) {
        Label("Check in", systemImage: "play.fill")
          .font(.system(size: 13, weight: .semibold))
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(.borderedProminent)
      .tint(.primary)
    } else {
      Button(intent: CheckOutIntent()) {
        Label("Check out", systemImage: "stop.fill")
          .font(.system(size: 13, weight: .semibold))
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(.bordered)
      .tint(.primary)
    }
  }
}

struct BreakButton: View {
  let snapshot: HoursSnapshot

  var body: some View {
    if snapshot.status == .onBreak {
      Button(intent: ResumeShiftIntent()) {
        Label("Resume", systemImage: "arrow.uturn.forward")
          .font(.system(size: 13, weight: .semibold))
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(.bordered)
      .tint(.primary)
    } else if snapshot.status == .working {
      Button(intent: StartBreakIntent()) {
        Label("Break", systemImage: "cup.and.saucer.fill")
          .font(.system(size: 13, weight: .semibold))
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(.bordered)
      .tint(.primary)
    }
  }
}
