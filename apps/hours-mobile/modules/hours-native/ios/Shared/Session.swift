import Foundation
import Security

/// The signed-in session, written by the app's JS (`@repo/native-auth`) and
/// read and refreshed here by widgets and App Intents. The JSON keys are that
/// package's `PersistedSession`.
public struct StoredSession: Codable, Equatable {
  public var site: String
  public var issuer: String
  public var clientId: String
  public var resource: String
  public var refreshToken: String
  public var accessToken: String
  /// Unix milliseconds.
  public var accessTokenExpiresAt: Double
}

/// One keychain item in the App Group's access group, readable after the
/// first unlock so a widget can refresh on a locked phone.
public enum SessionKeychain {
  private static let service = "com.denizlg24.hours.session"
  private static let account = "session"

  private static func query() -> [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    if let group = HoursShared.appGroup {
      query[kSecAttrAccessGroup as String] = group
    }
    return query
  }

  public static func readRaw() -> String? {
    var request = query()
    request[kSecReturnData as String] = true
    request[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(request as CFDictionary, &item) == errSecSuccess,
      let data = item as? Data
    else { return nil }
    return String(data: data, encoding: .utf8)
  }

  public static func writeRaw(_ raw: String?) {
    SecItemDelete(query() as CFDictionary)
    guard let raw, let data = raw.data(using: .utf8) else { return }
    var item = query()
    item[kSecValueData as String] = data
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    SecItemAdd(item as CFDictionary, nil)
  }

  public static func read() -> StoredSession? {
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

public enum HoursError: LocalizedError {
  case signedOut
  case server(Int, String)
  case unreadable

  public var errorDescription: String? {
    switch self {
    case .signedOut: return "Open Hours to sign in."
    case .server(_, let message): return message
    case .unreadable: return "Hours couldn't read the server's answer."
    }
  }
}

/// Access tokens for this process, refreshed at most once at a time. The
/// refresh token is a stable remember-me handle, so the app and the extension
/// refreshing independently never invalidate each other.
public actor SessionTokens {
  public static let shared = SessionTokens()
  private var refreshing: Task<String, Error>?

  public func accessToken(rejected: String? = nil) async throws -> String {
    guard let session = SessionKeychain.read() else { throw HoursError.signedOut }
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
        // Another process may have spent a rotating token a moment ago.
        if let latest = SessionKeychain.read(), latest.refreshToken != session.refreshToken {
          return latest.accessToken
        }
        SessionKeychain.write(nil)
        throw HoursError.signedOut
      }
      throw HoursError.server(status, code ?? "Sign-in refresh failed")
    }
    var next = SessionKeychain.read() ?? session
    next.accessToken = access
    next.accessTokenExpiresAt = (Date().timeIntervalSince1970 + expiresIn) * 1000
    if let rotated = body?["refresh_token"] as? String { next.refreshToken = rotated }
    SessionKeychain.write(next)
    return access
  }
}
