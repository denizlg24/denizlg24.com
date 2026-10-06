import SwiftUI
import WidgetKit

/// `MACROS_APP_GROUP` is set by plugins/with-widgets.js when the extension
/// is compiled with the shared App Group snapshot.
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
