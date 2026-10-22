import Foundation

enum HTTP {
    struct Failure: Error, LocalizedError {
        let status: Int
        let body: String

        var errorDescription: String? {
            let detail = body.trimmingCharacters(in: .whitespacesAndNewlines)
            return detail.isEmpty ? "HTTP \(status)" : "HTTP \(status): \(detail.prefix(160))"
        }
    }

    static let userAgent: String = {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev"
        return "Tally/\(version) (macOS)"
    }()

    static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20
        configuration.httpAdditionalHeaders = ["User-Agent": userAgent]
        return URLSession(configuration: configuration)
    }()

    static func data(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw Failure(status: status, body: String(decoding: data, as: UTF8.self))
        }
        return data
    }

    static func json<T: Decodable>(_ type: T.Type, _ request: URLRequest) async throws -> T {
        try decoder.decode(T.self, from: try await data(request))
    }

    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            if let seconds = try? container.decode(Double.self) {
                return Date(timeIntervalSince1970: seconds)
            }
            let string = try container.decode(String.self)
            guard let date = ISO8601.parse(string) else {
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "Bad date \(string)")
            }
            return date
        }
        return decoder
    }()
}

enum ISO8601 {
    static func parse(_ string: String) -> Date? {
        if let date = try? Date(string, strategy: .iso8601.year().month().day().time(includingFractionalSeconds: true).timeZone(separator: .colon)) {
            return date
        }
        if let date = try? Date(string, strategy: .iso8601) {
            return date
        }
        // Python's isoformat: six fractional digits, which the strategies above refuse.
        let trimmed = string.replacingOccurrences(
            of: #"\.(\d{3})\d+"#, with: ".$1", options: .regularExpression)
        return try? Date(trimmed, strategy: .iso8601.year().month().day().time(includingFractionalSeconds: true).timeZone(separator: .colon))
    }
}
