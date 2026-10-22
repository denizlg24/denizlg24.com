import AppKit
import SwiftUI
import Testing
@testable import Tally

/// Renders the real views against this Mac's live data, for eyeballing a
/// change without a screen. Opt-in:
/// `TEST_RUNNER_TALLY_SNAPSHOT_DIR=/tmp/tally xcodebuild test …` (xcodebuild
/// strips the prefix when it hands the variable to the test process).
@MainActor
struct SnapshotTests {
    nonisolated static let directory = ProcessInfo.processInfo.environment["TALLY_SNAPSHOT_DIR"]

    @Test(.enabled(if: directory != nil))
    func renderViews() async throws {
        let model = AppModel.shared
        await model.claude.sync()
        await model.refreshActivity()
        let output = URL(fileURLWithPath: try #require(Self.directory))
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        for scheme in [ColorScheme.light, .dark] {
            try write(DashboardContent(model: model).frame(width: 1100), scheme, to: output.appendingPathComponent("dashboard-\(scheme).png"))
            try write(MenuBarView(model: model), scheme, to: output.appendingPathComponent("menu-\(scheme).png"))
        }
    }

    private func write(_ view: some View, _ scheme: ColorScheme, to url: URL) throws {
        let renderer = ImageRenderer(
            content: view
                .environment(\.colorScheme, scheme)
                .background(scheme == .dark ? Color(white: 0.12) : Color(white: 0.98))
        )
        renderer.scale = 2
        let image = try #require(renderer.nsImage)
        let tiff = try #require(image.tiffRepresentation)
        let png = try #require(NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]))
        try png.write(to: url)
    }
}
