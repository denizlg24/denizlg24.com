import SwiftUI
import WidgetKit

/// `MACROS_APP_GROUP` is set by plugins/with-widgets.js only on a build that
/// carries the App Group (the ad-hoc one). Without it there is no snapshot to
/// read, so the data widgets are left out rather than shown empty forever.
@main
struct MacrosWidgetsBundle: WidgetBundle {
  var body: some Widget {
    QuickLogWidget()
    ShortcutWidget()
    #if MACROS_APP_GROUP
      TodayWidget()
      WeightWidget()
    #endif
  }
}
