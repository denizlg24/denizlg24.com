import Foundation
import Network

/// A one-shot HTTP listener on 127.0.0.1 for an OAuth redirect. The native
/// client's registered redirect is `http://127.0.0.1/callback` and the
/// authorization server ignores the loopback port, so any free port works.
final class LoopbackRedirect: @unchecked Sendable {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "com.denizlg24.tally.loopback")
    private var continuation: CheckedContinuation<URL, Error>?
    private var settled = false
    let port: UInt16

    var redirectURI: String { "http://127.0.0.1:\(port)/callback" }

    private init(listener: NWListener, port: UInt16) {
        self.listener = listener
        self.port = port
    }

    static func start() async throws -> LoopbackRedirect {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        let listener = try NWListener(using: parameters)
        let port: UInt16 = try await withCheckedThrowingContinuation { continuation in
            let once = Once()
            listener.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    once.run { continuation.resume(returning: listener.port?.rawValue ?? 0) }
                case .failed(let error):
                    once.run { continuation.resume(throwing: error) }
                default:
                    break
                }
            }
            listener.newConnectionHandler = { $0.cancel() }
            listener.start(queue: DispatchQueue(label: "com.denizlg24.tally.loopback.start"))
        }
        let redirect = LoopbackRedirect(listener: listener, port: port)
        listener.newConnectionHandler = { [redirect] connection in redirect.accept(connection) }
        return redirect
    }

    /// Waits for the browser to land on `/callback`.
    func callback() async throws -> URL {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                queue.sync {
                    if settled {
                        continuation.resume(throwing: CancellationError())
                    } else {
                        self.continuation = continuation
                    }
                }
            }
        } onCancel: {
            finish(.failure(CancellationError()))
        }
    }

    func cancel() {
        finish(.failure(CancellationError()))
    }

    private func finish(_ result: Result<URL, Error>) {
        queue.async { [self] in
            guard !settled else { return }
            settled = true
            listener.cancel()
            continuation?.resume(with: result)
            continuation = nil
        }
    }

    private func accept(_ connection: NWConnection) {
        connection.start(queue: queue)
        receive(connection, buffer: Data())
    }

    private func receive(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16384) { [self] data, _, complete, error in
            var buffer = buffer
            if let data { buffer.append(data) }
            guard let end = buffer.range(of: Data("\r\n\r\n".utf8)) else {
                if complete || error != nil || buffer.count > 65536 {
                    connection.cancel()
                } else {
                    receive(connection, buffer: buffer)
                }
                return
            }
            let head = String(decoding: buffer[..<end.lowerBound], as: UTF8.self)
            let target = head.split(separator: "\r\n").first?.split(separator: " ").dropFirst().first.map(String.init)
            guard let target, target.hasPrefix("/callback"),
                  let url = URL(string: "http://127.0.0.1:\(port)\(target)")
            else {
                respond(connection, status: "404 Not Found", body: "")
                return
            }
            respond(connection, status: "200 OK", body: Self.page)
            finish(.success(url))
        }
    }

    private func respond(_ connection: NWConnection, status: String, body: String) {
        let payload = Data(body.utf8)
        let head = "HTTP/1.1 \(status)\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(payload.count)\r\nConnection: close\r\n\r\n"
        connection.send(content: Data(head.utf8) + payload, completion: .contentProcessed { _ in connection.cancel() })
    }

    private static let page = """
    <!doctype html><meta charset="utf-8"><title>Tally</title>
    <body style="font:15px -apple-system;display:grid;place-items:center;height:90vh;color:#444">
    Tally is signed in.<script>setTimeout(()=>window.close(),300)</script>
    """
}

private final class Once: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false

    func run(_ body: () -> Void) {
        lock.lock()
        defer { lock.unlock() }
        guard !done else { return }
        done = true
        body()
    }
}
