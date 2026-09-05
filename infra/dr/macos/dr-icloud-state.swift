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
// Raw values rather than the CocoaError cases, so this keeps compiling on an
// older toolchain: 4353 NSUbiquitousFileUnavailableError, 4355
// NSUbiquitousFileUbiquityServerNotAvailable. Both describe a server or item
// that is momentarily out of reach. 4354, the quota error, is deliberately not
// here — no amount of waiting creates storage.
func isRetryableUbiquityError(_ error: NSError) -> Bool {
    guard error.domain == NSCocoaErrorDomain else { return false }
    return error.code == 4353 || error.code == 4355
}

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
        // A `URL` caches resource values on the `NSURL` backing it, so one built
        // once outside this loop answers every later poll from whatever the
        // first read returned. An item that was still uploading when the wait
        // began then reads as not-uploaded for the rest of the loop and the
        // wait can only end at the deadline — which is indistinguishable from
        // iCloud being broken, and was diagnosed as exactly that. Rebuild the
        // URL each poll so every read reaches the File Provider.
        var probe = URL(fileURLWithPath: path)
        probe.removeAllCachedResourceValues()
        let values = try probe.resourceValues(forKeys: [
            .isUbiquitousItemKey,
            .ubiquitousItemIsUploadedKey,
            .ubiquitousItemUploadingErrorKey,
            .ubiquitousItemDownloadingErrorKey,
            .ubiquitousItemDownloadingStatusKey,
        ])

        // The loop below exists to outlast a transient condition, but every
        // provider error was treated as terminal — including
        // NSUbiquitousFileUbiquityServerNotAvailable, which means exactly
        // "the server is not reachable, try again". Seeding tens of
        // gigabytes takes hours and sees that routinely, and a single
        // occurrence aborted the whole mirror with the snapshot half copied.
        // Quota is the error that genuinely needs a person, so it still
        // fails immediately rather than spinning to the deadline.
        if let error = values.ubiquitousItemUploadingError as NSError?,
            !isRetryableUbiquityError(error) {
            fail("iCloud upload failed for \(path): \(error)")
        }
        if let error = values.ubiquitousItemDownloadingError as NSError?,
            !isRetryableUbiquityError(error) {
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
                let handle = try FileHandle(forReadingFrom: probe)
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
