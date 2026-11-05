#!/usr/bin/env swift
import AppKit
import Foundation

// Run from the repository root. Production artwork is read, never modified.
let icons = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    .appendingPathComponent("src-tauri/icons", isDirectory: true)
guard let original = NSImage(contentsOf: icons.appendingPathComponent("icon.png")) else {
    fatalError("Cannot load src-tauri/icons/icon.png")
}

func png(size: Int) throws -> Data {
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
        isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    ), let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        throw CocoaError(.coderInvalidValue)
    }
    NSGraphicsContext.saveGraphicsState()
    defer { NSGraphicsContext.restoreGraphicsState() }
    NSGraphicsContext.current = context
    context.imageInterpolation = .high
    let extent = CGFloat(size)
    original.draw(in: NSRect(x: 0, y: 0, width: extent, height: extent))
    NSColor(red: 0.76, green: 0.25, blue: 0.05, alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(x: extent * 0.08, y: extent * 0.06,
        width: extent * 0.84, height: extent * 0.30),
        xRadius: extent * 0.06, yRadius: extent * 0.06).fill()
    let attributes: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: extent * 0.25, weight: .heavy),
        .foregroundColor: NSColor.white,
    ]
    let label = "DEV" as NSString
    let bounds = label.size(withAttributes: attributes)
    label.draw(at: NSPoint(x: (extent - bounds.width) / 2,
        y: extent * 0.21 - bounds.height / 2), withAttributes: attributes)
    guard let data = bitmap.representation(using: .png, properties: [:]) else {
        throw CocoaError(.fileWriteUnknown)
    }
    return data
}

func bigEndian(_ value: Int) -> Data {
    var bytes = UInt32(value).bigEndian
    return withUnsafeBytes(of: &bytes) { Data($0) }
}

// ICNS stores PNG representations in independently typed, length-prefixed blocks.
var representations = Data()
for (type, size) in [("icp4", 16), ("icp5", 32), ("icp6", 64), ("ic07", 128),
                     ("ic08", 256), ("ic09", 512), ("ic10", 1024)] {
    let image = try png(size: size)
    representations.append(Data(type.utf8))
    representations.append(bigEndian(image.count + 8))
    representations.append(image)
    if size == 512 {
        try image.write(to: icons.appendingPathComponent("dev.png"), options: .atomic)
    }
}
var family = Data("icns".utf8)
family.append(bigEndian(representations.count + 8))
family.append(representations)
try family.write(to: icons.appendingPathComponent("dev.icns"), options: .atomic)
print("Generated development-only dev.png and dev.icns")
