import SwiftUI

/// `packages/ui/src/theme.css`, light and dark.
extension Color {
  static let themeBackground = Color(light: 0xF9F8F6, dark: 0x303630)
  static let themeLabel = Color(light: 0x303630, dark: 0xF1F3E0)
  static let themeSecondary = Color(light: 0x647560, dark: 0xD2DCB6)
  static let themeAccent = Color(light: 0xA1BC98, dark: 0xA1BC98)
  static let themeTint = Color(light: 0x303630, dark: 0xA1BC98)
  static let themeOnTint = Color(light: 0xF9F8F6, dark: 0x303630)

  init(light: UInt32, dark: UInt32) {
    self.init(uiColor: UIColor(light: light, dark: dark))
  }
}

extension UIColor {
  convenience init(light: UInt32, dark: UInt32) {
    self.init { traits in
      UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light)
    }
  }

  convenience init(hex: UInt32, alpha: CGFloat = 1) {
    self.init(
      red: CGFloat((hex >> 16) & 0xFF) / 255,
      green: CGFloat((hex >> 8) & 0xFF) / 255,
      blue: CGFloat(hex & 0xFF) / 255,
      alpha: alpha)
  }
}

extension Font {
  static func figure(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
    .system(size: size, weight: weight).monospacedDigit()
  }
}

struct Eyebrow: View {
  let text: String

  var body: some View {
    Text(text.uppercased())
      .font(.system(size: 10, weight: .semibold))
      .tracking(0.8)
      .foregroundStyle(Color.themeSecondary)
  }
}
