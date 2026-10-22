import Foundation

/// Serialises async work on the main actor. Seat switching, credential capture
/// and token refresh all read-modify-write the same keychain items, and an
/// `await` inside any of them is a point where another could interleave.
@MainActor
final class AsyncLock {
    private var held = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func run<T>(_ body: () async throws -> T) async rethrows -> T {
        if held {
            await withCheckedContinuation { waiters.append($0) }
        } else {
            held = true
        }
        defer {
            if waiters.isEmpty {
                held = false
            } else {
                waiters.removeFirst().resume()
            }
        }
        return try await body()
    }
}
