import Foundation
import Security

/// The signed-in session, written by the app's JS (`@repo/native-auth`) and
/// read and refreshed here, because a location event can wake the app with
/// no JavaScript running. The JSON keys are that package's `PersistedSession`.
struct StoredSession: Codable {
  var site: String
  var issuer: String
  var clientId: String
  var resource: String
  var refreshToken: String
  var accessToken: String
  /// Unix milliseconds.
  var accessTokenExpiresAt: Double
}

/// Readable after the first unlock: iOS relaunches the app for a visit or a
/// significant change while the phone is locked.
enum SessionKeychain {
  private static let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "com.denizlg24.location.session",
    kSecAttrAccount as String: "session",
  ]

  static func readRaw() -> String? {
    var request = query
    request[kSecReturnData as String] = true
    request[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(request as CFDictionary, &item) == errSecSuccess,
      let data = item as? Data
    else { return nil }
    return String(data: data, encoding: .utf8)
  }

  static func writeRaw(_ raw: String?) {
    SecItemDelete(query as CFDictionary)
    guard let raw, let data = raw.data(using: .utf8) else { return }
    var item = query
    item[kSecValueData as String] = data
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    SecItemAdd(item as CFDictionary, nil)
  }

  static func read() -> StoredSession? {
    guard let raw = readRaw(), let data = raw.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(StoredSession.self, from: data)
  }

  static func write(_ session: StoredSession?) {
    guard let session, let data = try? JSONEncoder().encode(session) else {
      writeRaw(nil)
      return
    }
    writeRaw(String(data: data, encoding: .utf8))
  }
}

enum LocationError: LocalizedError {
  case signedOut
  case server(Int, String)

  var errorDescription: String? {
    switch self {
    case .signedOut: return "Signed out"
    case .server(_, let message): return message
    }
  }
}

/// Access tokens, refreshed at most once at a time. The refresh token is the
/// remember-me handle, so JS and Swift refreshing independently never spend
/// each other's token.
actor SessionTokens {
  static let shared = SessionTokens()
  private var refreshing: Task<String, Error>?

  func accessToken(rejected: String? = nil) async throws -> String {
    guard let session = SessionKeychain.read() else { throw LocationError.signedOut }
    let fresh = session.accessTokenExpiresAt - Date().timeIntervalSince1970 * 1000 > 60_000
    if fresh && session.accessToken != rejected { return session.accessToken }
    if let refreshing { return try await refreshing.value }
    let task = Task { try await Self.refresh(session) }
    refreshing = task
    defer { refreshing = nil }
    return try await task.value
  }

  private static func refresh(_ session: StoredSession) async throws -> String {
    var request = URLRequest(url: URL(string: "\(session.issuer)/oauth2/token")!)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "content-type")
    var form = URLComponents()
    form.queryItems = [
      URLQueryItem(name: "grant_type", value: "refresh_token"),
      URLQueryItem(name: "refresh_token", value: session.refreshToken),
      URLQueryItem(name: "client_id", value: session.clientId),
      URLQueryItem(name: "resource", value: session.resource),
    ]
    request.httpBody = form.percentEncodedQuery?
      .replacingOccurrences(of: "+", with: "%2B")
      .data(using: .utf8)
    let (data, response) = try await URLSession.shared.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    guard status == 200, let access = body?["access_token"] as? String,
      let expiresIn = body?["expires_in"] as? Double
    else {
      let code = body?["error"] as? String
      if code == "invalid_grant" || code == "invalid_client" {
        if let latest = SessionKeychain.read(), latest.refreshToken != session.refreshToken {
          return latest.accessToken
        }
        SessionKeychain.write(nil)
        throw LocationError.signedOut
      }
      throw LocationError.server(status, code ?? "Sign-in refresh failed")
    }
    var next = SessionKeychain.read() ?? session
    next.accessToken = access
    next.accessTokenExpiresAt = (Date().timeIntervalSince1970 + expiresIn) * 1000
    if let rotated = body?["refresh_token"] as? String { next.refreshToken = rotated }
    SessionKeychain.write(next)
    return access
  }
}
