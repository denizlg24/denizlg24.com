import SwiftUI
import WidgetKit

@main
struct HoursWidgetBundle: WidgetBundle {
  var body: some Widget {
    ShiftWidget()
    WeekWidget()
    ShiftLiveActivity()
    ShiftControl()
  }
}
