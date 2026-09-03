import Foundation

enum Command: String {
    case waitUploaded = "wait-uploaded"
    case hydrate
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data(("STOP: \(message)\n").utf8))
    exit(1)
}

guard CommandLine.arguments.count >= 3,
      let command = Command(rawValue: CommandLine.arguments[1]) else {
    fail("usage: dr-icloud-state wait-uploaded|hydrate PATH [TIMEOUT_SECONDS]")
}

let path = CommandLine.arguments[2]
let timeout = TimeInterval(CommandLine.arguments.count > 3 ? CommandLine.arguments[3] : "3600") ?? 3600
let url = URL(fileURLWithPath: path)
let deadline = Date().addingTimeInterval(timeout)

if command == .hydrate {
    do {
        try FileManager.default.startDownloadingUbiquitousItem(at: url)
    } catch {
        fail("could not request iCloud hydration for \(path): \(error)")
    }
}

while Date() < deadline {
    do {
        let values = try url.resourceValues(forKeys: [
            .isUbiquitousItemKey,
            .ubiquitousItemIsUploadedKey,
            .ubiquitousItemUploadingErrorKey,
            .ubiquitousItemDownloadingErrorKey,
            .ubiquitousItemDownloadingStatusKey,
        ])

        if let error = values.ubiquitousItemUploadingError {
            fail("iCloud upload failed for \(path): \(error)")
        }
        if let error = values.ubiquitousItemDownloadingError {
            fail("iCloud download failed for \(path): \(error)")
        }

        if values.isUbiquitousItem != true {
            fail("path is not managed by iCloud/File Provider: \(path)")
        }

        switch command {
        case .waitUploaded:
            if values.ubiquitousItemIsUploaded == true { exit(0) }
        case .hydrate:
            if values.ubiquitousItemDownloadingStatus == .current {
                // Opening and reading the byte is a second guard against a
                // stale metadata bit on an evicted placeholder.
                let handle = try FileHandle(forReadingFrom: url)
                _ = try handle.read(upToCount: 1)
                try handle.close()
                exit(0)
            }
        }
    } catch {
        // File Provider can briefly replace a placeholder while materialising.
        // Retry until the bounded timeout; terminal provider errors fail above.
    }
    Thread.sleep(forTimeInterval: 2)
}

fail("timed out waiting for iCloud \(command.rawValue) state: \(path)")
