import SwiftUI
import WidgetKit

@main
struct LocationWidgetBundle: WidgetBundle {
  var body: some Widget {
    ExploreWidget()
    MapWidget()
    ExploreControl()
  }
}
