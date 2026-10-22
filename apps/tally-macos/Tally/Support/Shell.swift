import Foundation

enum Shell {
    struct Failure: Error, LocalizedError {
        let command: String
        let status: Int32
        let stderr: String

        var errorDescription: String? {
            let detail = stderr.trimmingCharacters(in: .whitespacesAndNewlines)
            return detail.isEmpty ? "\(command) exited \(status)" : "\(command): \(detail)"
        }
    }

    /// Runs a tool to completion. Input goes through stdin rather than argv so
    /// a secret written with it never shows up in `ps`.
    static func run(_ executable: String, _ arguments: [String], input: Data? = nil) async throws -> Data {
        try await Task.detached(priority: .utility) {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: executable)
            process.arguments = arguments
            let stdout = Pipe()
            let stderr = Pipe()
            let stdin = Pipe()
            process.standardOutput = stdout
            process.standardError = stderr
            process.standardInput = input == nil ? FileHandle.nullDevice : stdin
            try process.run()
            if let input {
                try stdin.fileHandleForWriting.write(contentsOf: input)
                try stdin.fileHandleForWriting.close()
            }
            // Drained on its own thread: a tool that fills the stderr pipe
            // while stdout is being read would otherwise block forever.
            let errorOutput = ErrorDrain(stderr.fileHandleForReading)
            let output = stdout.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else {
                throw Failure(
                    command: URL(fileURLWithPath: executable).lastPathComponent,
                    status: process.terminationStatus,
                    stderr: String(decoding: errorOutput.wait(), as: UTF8.self)
                )
            }
            return output
        }.value
    }
}

private final class ErrorDrain: @unchecked Sendable {
    private var data = Data()
    private let done = DispatchSemaphore(value: 0)

    init(_ handle: FileHandle) {
        Thread.detachNewThread { [self] in
            data = handle.readDataToEndOfFile()
            done.signal()
        }
    }

    func wait() -> Data {
        done.wait()
        return data
    }
}
