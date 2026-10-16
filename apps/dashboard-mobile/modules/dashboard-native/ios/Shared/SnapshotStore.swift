import Foundation
import WidgetKit

/// The JSON the app last fetched, kept in the App Group for the widgets: the
/// Today payload and the watchlist quotes. Widgets read only what is stored
/// here, or refetch Today themselves; they never call the quote provider.
public enum SnapshotStore {
  public enum Key: String {
    case today
    case watchlist
  }

  public static func save(_ key: Key, _ data: Data) {
    DashboardShared.defaults?.set(data, forKey: key.rawValue)
    DashboardShared.defaults?.set(Date().timeIntervalSince1970, forKey: "\(key.rawValue).at")
  }

  public static func load(_ key: Key) -> (data: Data, at: Date)? {
    guard let defaults = DashboardShared.defaults,
      let data = defaults.data(forKey: key.rawValue)
    else { return nil }
    let at = defaults.double(forKey: "\(key.rawValue).at")
    return (data, Date(timeIntervalSince1970: at))
  }

  public static func clear() {
    for key in [Key.today, Key.watchlist] {
      DashboardShared.defaults?.removeObject(forKey: key.rawValue)
      DashboardShared.defaults?.removeObject(forKey: "\(key.rawValue).at")
    }
  }

  public static func reloadWidgets() {
    WidgetCenter.shared.reloadAllTimelines()
  }
}
