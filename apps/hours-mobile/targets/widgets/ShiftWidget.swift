import AppIntents
import SwiftUI
import WidgetKit

struct ShiftWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "HoursShift", provider: HoursProvider()) { entry in
      ShiftWidgetView(snapshot: entry.snapshot)
        .containerBackground(.background, for: .widget)
        .widgetURL(URL(string: "hours://"))
    }
    .configurationDisplayName("Shift")
    .description("The running shift, with check in and out.")
    .supportedFamilies([
      .systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline,
    ])
  }
}

struct ShiftWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let snapshot: HoursSnapshot

  var body: some View {
    switch family {
    case .accessoryCircular: circular
    case .accessoryRectangular: rectangular
    case .accessoryInline: inline
    case .systemMedium: medium
    default: small
    }
  }

  private var header: some View {
    HStack(spacing: 6) {
      StatusDot(status: snapshot.status)
      Eyebrow(text: statusLabel(snapshot))
    }
  }

  private var small: some View {
    VStack(alignment: .leading, spacing: 4) {
      header
      Spacer(minLength: 0)
      ShiftClock(snapshot: snapshot, size: 30)
      HStack(spacing: 4) {
        Text("today").foregroundStyle(.secondary)
        RunningTotal(snapshot: snapshot, baseMinutes: snapshot.todayBaseMinutes, size: 12)
      }
      .font(.system(size: 12))
      Spacer(minLength: 0)
      if snapshot.hasJobs {
        ShiftButton(snapshot: snapshot)
      }
    }
  }

  private var medium: some View {
    HStack(alignment: .top, spacing: 16) {
      VStack(alignment: .leading, spacing: 4) {
        header
        Spacer(minLength: 0)
        ShiftClock(snapshot: snapshot, size: 34)
        if let job = snapshot.jobName {
          Text(job).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
        }
        Spacer(minLength: 0)
        HStack(spacing: 14) {
          stat("Today", base: snapshot.todayBaseMinutes)
          stat("Week", base: snapshot.weekBaseMinutes)
        }
      }
      if snapshot.hasJobs {
        VStack(spacing: 8) {
          Spacer(minLength: 0)
          BreakButton(snapshot: snapshot)
          ShiftButton(snapshot: snapshot)
        }
        .frame(width: 118)
      }
    }
  }

  private func stat(_ label: String, base: Int) -> some View {
    VStack(alignment: .leading, spacing: 1) {
      Eyebrow(text: label)
      RunningTotal(snapshot: snapshot, baseMinutes: base, size: 15)
    }
  }

  private var circular: some View {
    ZStack {
      AccessoryWidgetBackground()
      VStack(spacing: 0) {
        Image(systemName: snapshot.status == .onBreak ? "cup.and.saucer.fill" : "clock")
          .font(.system(size: 11, weight: .semibold))
        if snapshot.status == .working, let from = snapshot.workedFrom {
          Text(timerInterval: from...Date.distantFuture, countsDown: false, showsHours: true)
            .font(.figure(11))
            .multilineTextAlignment(.center)
        } else {
          Text(HoursDates.minutes(snapshot.todayMinutes(at: Date())))
            .font(.figure(13))
        }
      }
      .padding(4)
    }
    .widgetAccentable()
  }

  private var rectangular: some View {
    VStack(alignment: .leading, spacing: 1) {
      HStack(spacing: 4) {
        Image(systemName: snapshot.status == .onBreak ? "cup.and.saucer.fill" : "clock")
        Text(statusLabel(snapshot)).lineLimit(1)
      }
      .font(.system(size: 12, weight: .semibold))
      .widgetAccentable()
      ShiftClock(snapshot: snapshot, size: 20)
      HStack(spacing: 3) {
        Text("week")
        RunningTotal(snapshot: snapshot, baseMinutes: snapshot.weekBaseMinutes, size: 12)
        if let target = snapshot.weeklyTargetMinutes {
          Text("/ \(HoursDates.minutes(target))")
        }
      }
      .font(.system(size: 12))
      .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  @ViewBuilder
  private var inline: some View {
    switch snapshot.status {
    case .working:
      if let from = snapshot.workedFrom {
        Text("In ") + Text(timerInterval: from...Date.distantFuture, countsDown: false)
      }
    case .onBreak:
      Text("Break · \(HoursDates.minutes(snapshot.workedSeconds / 60)) worked")
    case .off:
      Text("Off · \(HoursDates.minutes(snapshot.todayBaseMinutes)) today")
    }
  }
}
