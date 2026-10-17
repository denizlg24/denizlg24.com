import SwiftUI

/// `packages/ui/src/theme.css`, light and dark; status hues as `@repo/native-ui` has them.
extension Color {
  static let themeBackground = Color(light: 0xF9F8F6, dark: 0x303630)
  static let themeLabel = Color(light: 0x303630, dark: 0xF1F3E0)
  static let themeWorking = Color(light: 0x0C8A0C, dark: 0x4FB84F)
  static let themeBreak = Color(light: 0xB97D0A, dark: 0xE0A020)

  init(light: UInt32, dark: UInt32) {
    self.init(
      uiColor: UIColor { traits in
        let hex = traits.userInterfaceStyle == .dark ? dark : light
        return UIColor(
          red: CGFloat((hex >> 16) & 0xFF) / 255,
          green: CGFloat((hex >> 8) & 0xFF) / 255,
          blue: CGFloat(hex & 0xFF) / 255,
          alpha: 1)
      })
  }
}
