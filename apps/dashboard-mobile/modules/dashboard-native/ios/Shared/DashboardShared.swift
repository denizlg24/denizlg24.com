import Foundation

/// What the app, its widget extension and the Share extension share: the App
/// Group (stored snapshots, the installation id) and the site the API lives
/// on. Each reads its own Info.plist, which the config plugin fills alike.
public enum DashboardShared {
  public static var appGroup: String? {
    Bundle.main.object(forInfoDictionaryKey: "DashboardAppGroup") as? String
  }

  public static var site: URL {
    let raw = Bundle.main.object(forInfoDictionaryKey: "DashboardSite") as? String
    return URL(string: raw ?? "https://denizlg24.com")!
  }

  /// Nil when the installed signature does not grant the group.
  public static var defaults: UserDefaults? {
    guard
      let group = appGroup,
      FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) != nil
    else { return nil }
    return UserDefaults(suiteName: group)
  }

  /// Sent as `x-mobile-installation` so the server skips this phone when it
  /// pushes a change the phone made itself.
  public static var installationId: String {
    let key = "installationId"
    if let existing = defaults?.string(forKey: key) { return existing }
    let fresh = UUID().uuidString.lowercased()
    defaults?.set(fresh, forKey: key)
    return fresh
  }
}

public enum DashboardDates {
  private static let fractional: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()

  private static let whole: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter
  }()

  public static func parse(_ value: String?) -> Date? {
    guard let value else { return nil }
    return fractional.date(from: value) ?? whole.date(from: value)
  }
}
