import SwiftUI
import WidgetKit

/// Routes in src/app, opened through the app's `macros` scheme.
enum AppLink {
  static let today = URL(string: "macros://")!
  static let log = URL(string: "macros://log")!
  static let progress = URL(string: "macros://progress")!
  static let search = URL(string: "macros://add-food")!
  static let scan = URL(string: "macros://scan")!
  static let quickAdd = URL(string: "macros://quick-add")!
  static let weighIn = URL(string: "macros://weigh-in")!
}

extension Color {
  /// `#rrggbb`, as the snapshot carries the app's macro hues.
  init(hex: String) {
    let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
    let value = UInt64(digits, radix: 16) ?? 0
    self.init(
      red: Double((value >> 16) & 0xFF) / 255,
      green: Double((value >> 8) & 0xFF) / 255,
      blue: Double(value & 0xFF) / 255
    )
  }
}

enum Figure {
  static func integer(_ value: Double) -> String {
    Int(value.rounded()).formatted()
  }

  static func decimal(_ value: Double) -> String {
    value.formatted(.number.precision(.fractionLength(0...1)))
  }

  /// "−1.3", "+0.4", "0".
  static func signed(_ value: Double) -> String {
    let magnitude = decimal(abs(value))
    if magnitude == decimal(0) { return magnitude }
    return (value < 0 ? "−" : "+") + magnitude
  }
}

extension Font {
  /// SF Pro Rounded with tabular digits, the app's `Text figure`.
  static func figure(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
    .system(size: size, weight: weight, design: .rounded).monospacedDigit()
  }
}

/// The app's section label: small, uppercase, secondary.
struct Eyebrow: View {
  let text: String

  var body: some View {
    Text(text.uppercased())
      .font(.system(size: 11, weight: .semibold))
      .tracking(0.6)
      .foregroundStyle(.secondary)
      .lineLimit(1)
  }
}

/// The 3 pt `Meter` from the app, with its overflow colour past the target.
struct Meter: View {
  let value: Double
  let target: Double?
  let color: Color
  var overColor: Color = Color(hex: "#c4834a")

  var body: some View {
    GeometryReader { proxy in
      let progress = target.map { $0 > 0 ? value / $0 : 0 } ?? 0
      ZStack(alignment: .leading) {
        Capsule().fill(.quaternary)
        Capsule()
          .fill(progress > 1 ? overColor : color)
          .frame(width: proxy.size.width * min(1, max(0, progress)))
      }
    }
    .frame(height: 3)
  }
}

extension View {
  /// The app's tint is the label colour; links would otherwise be blue.
  func widgetBackground() -> some View {
    tint(.primary)
      .containerBackground(for: .widget) { Color(uiColor: .systemBackground) }
  }
}

/// What a data widget shows before the app has written a snapshot.
struct OpenAppPrompt: View {
  let title: String

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Eyebrow(text: title)
      Spacer(minLength: 0)
      Text("Open Macros to show your day here.")
        .font(.footnote)
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }
}
