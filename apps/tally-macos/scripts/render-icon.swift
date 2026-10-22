// Renders Tally's app icon into the asset catalog.
//
//   swift apps/tally-macos/scripts/render-icon.swift
//
// Four strokes and the fifth struck across them, on Apple's macOS icon grid
// (an 824-point body inside a 1024 canvas).

import AppKit

let output = URL(fileURLWithPath: CommandLine.arguments.count > 1
    ? CommandLine.arguments[1]
    : "apps/tally-macos/Tally/Assets.xcassets/AppIcon.appiconset")

func render(pixels: Int) -> Data {
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    )!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let context = NSGraphicsContext.current!.cgContext
    let scale = CGFloat(pixels) / 1024
    context.scaleBy(x: scale, y: scale)

    let body = CGRect(x: 100, y: 100, width: 824, height: 824)
    let shape = CGPath(roundedRect: body, cornerWidth: 186, cornerHeight: 186, transform: nil)

    context.saveGState()
    context.setShadow(offset: CGSize(width: 0, height: -10), blur: 28, color: NSColor.black.withAlphaComponent(0.35).cgColor)
    context.addPath(shape)
    context.setFillColor(NSColor.black.cgColor)
    context.fillPath()
    context.restoreGState()

    context.saveGState()
    context.addPath(shape)
    context.clip()
    let background = CGGradient(
        colorsSpace: CGColorSpaceCreateDeviceRGB(),
        colors: [
            NSColor(srgbRed: 0.20, green: 0.205, blue: 0.225, alpha: 1).cgColor,
            NSColor(srgbRed: 0.075, green: 0.078, blue: 0.09, alpha: 1).cgColor,
        ] as CFArray,
        locations: [0, 1]
    )!
    context.drawLinearGradient(background, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])
    let sheen = CGGradient(
        colorsSpace: CGColorSpaceCreateDeviceRGB(),
        colors: [NSColor.white.withAlphaComponent(0.10).cgColor, NSColor.white.withAlphaComponent(0).cgColor] as CFArray,
        locations: [0, 1]
    )!
    context.drawLinearGradient(sheen, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 640), options: [])
    context.restoreGState()

    let ivory = NSColor(srgbRed: 0.95, green: 0.93, blue: 0.89, alpha: 1).cgColor
    let coral = NSColor(srgbRed: 0.85, green: 0.47, blue: 0.34, alpha: 1).cgColor
    let strokeWidth: CGFloat = 54
    let gap: CGFloat = 70
    let height: CGFloat = 430
    let originX = 512 - (strokeWidth * 4 + gap * 3) / 2
    let originY: CGFloat = 512 - height / 2

    context.setFillColor(ivory)
    for index in 0..<4 {
        let x = originX + CGFloat(index) * (strokeWidth + gap)
        let bar = CGRect(x: x, y: originY, width: strokeWidth, height: height)
        context.addPath(CGPath(roundedRect: bar, cornerWidth: strokeWidth / 2, cornerHeight: strokeWidth / 2, transform: nil))
        context.fillPath()
    }

    context.saveGState()
    context.setShadow(offset: CGSize(width: 0, height: -6), blur: 16, color: NSColor.black.withAlphaComponent(0.45).cgColor)
    context.setStrokeColor(coral)
    context.setLineWidth(strokeWidth)
    context.setLineCap(.round)
    context.move(to: CGPoint(x: originX - 46, y: originY + 40))
    context.addLine(to: CGPoint(x: originX + strokeWidth * 4 + gap * 3 + 46, y: originY + height - 40))
    context.strokePath()
    context.restoreGState()

    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

struct Slot {
    let points: Int
    let scale: Int
    var pixels: Int { points * scale }
    var filename: String { "icon_\(points)x\(points)\(scale == 2 ? "@2x" : "").png" }
}

let slots = [16, 32, 128, 256, 512].flatMap { [Slot(points: $0, scale: 1), Slot(points: $0, scale: 2)] }
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
var images: [[String: String]] = []
for slot in slots {
    try render(pixels: slot.pixels).write(to: output.appendingPathComponent(slot.filename))
    images.append([
        "idiom": "mac",
        "size": "\(slot.points)x\(slot.points)",
        "scale": "\(slot.scale)x",
        "filename": slot.filename,
    ])
}
let contents: [String: Any] = ["images": images, "info": ["author": "xcode", "version": 1]]
try JSONSerialization.data(withJSONObject: contents, options: [.prettyPrinted, .sortedKeys])
    .write(to: output.appendingPathComponent("Contents.json"))
print("Wrote \(slots.count) icons to \(output.path)")
