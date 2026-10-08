import Foundation

/// What the app and its widget extension share: the App Group (the overview
/// snapshot, the installation id) and the site the API lives on. Both read
/// their own Info.plist, which the config plugin fills identically.
public enum HoursShared {
  public static var appGroup: String? {
    Bundle.main.object(forInfoDictionaryKey: "HoursAppGroup") as? String
  }

  public static var site: URL {
    let raw = Bundle.main.object(forInfoDictionaryKey: "HoursSite") as? String
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

public enum HoursDates {
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

  private static let dayFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter
  }()

  /// A `yyyy-MM-dd` day at local midnight.
  public static func day(_ value: String) -> Date? {
    dayFormatter.date(from: value)
  }

  public static func parse(_ value: String?) -> Date? {
    guard let value else { return nil }
    return fractional.date(from: value) ?? whole.date(from: value)
  }

  /// `h:mm`, the way the app and a timesheet read.
  public static func minutes(_ total: Int) -> String {
    let value = max(0, total)
    return "\(value / 60):" + String(format: "%02d", value % 60)
  }
}
