import AppIntents
import SwiftUI
import WidgetKit

/// Control Center, the Lock Screen's bottom corners and the Action Button: a
/// toggle that is on while checked in.
struct ShiftControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "com.denizlg24.hours.shift", provider: ShiftValueProvider()) {
      checkedIn in
      ControlWidgetToggle("Shift", isOn: checkedIn, action: SetShiftIntent()) { on in
        Label(on ? "Checked in" : "Off", systemImage: on ? "clock.fill" : "clock")
      }
      .tint(.green)
    }
    .displayName("Shift")
    .description("Check in and out.")
  }
}

struct ShiftValueProvider: ControlValueProvider {
  var previewValue: Bool { false }

  func currentValue() async throws -> Bool {
    await HoursSync.current(maxAge: 60).status != .off
  }
}
