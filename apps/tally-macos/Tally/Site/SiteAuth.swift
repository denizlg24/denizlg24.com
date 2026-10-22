import AppKit
import CryptoKit
import Foundation

/// Sign-in to denizlg24.com as the desktop app does: authorization code + PKCE
/// as the `native` public client, with the issuer, client and resource read
/// from `/api/public/desktop-auth` so nothing environment-specific is built in.
actor SiteAuth {
    static let origin = URL(string: "https://denizlg24.com")!
    private static let service = "com.denizlg24.tally.site"
    private static let scope = "openid offline_access"

    struct Config: Codable, Sendable {
        let issuer: String
        let clientId: String
        let resource: String
    }

    private struct Session: Codable {
        let config: Config
        var refreshToken: String
    }

    private struct TokenResponse: Decodable {
        let accessToken: String
        let expiresIn: Double
        let refreshToken: String?
    }

    private struct OAuthError: Decodable {
        let error: String
        let errorDescription: String?
    }

    struct GrantRefused: Error, LocalizedError {
        let code: String
        var errorDescription: String? { "Signed out (\(code))" }
    }

    struct NotSignedIn: Error, LocalizedError {
        var errorDescription: String? { "Not signed in" }
    }

    private var session: Session?
    private var accessToken: (value: String, expiresAt: Date)?
    private var refreshing: Task<String, Error>?
    private var pending: LoopbackRedirect?

    init() {
        session = (try? Keychain.read(service: Self.service, account: "session"))
            .flatMap { try? JSONDecoder().decode(Session.self, from: $0) }
    }

    var isSignedIn: Bool { session != nil }

    func signIn() async throws {
        pending?.cancel()
        let config = try await HTTP.json(
            Config.self,
            URLRequest(url: Self.origin.appendingPathComponent("api/public/desktop-auth"))
        )
        let redirect = try await LoopbackRedirect.start()
        pending = redirect
        defer { redirect.cancel() }

        let verifier = Self.randomURLSafe(32)
        let state = Self.randomURLSafe(16)
        var components = URLComponents(string: "\(config.issuer)/oauth2/authorize")!
        components.queryItems = [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: config.clientId),
            URLQueryItem(name: "redirect_uri", value: redirect.redirectURI),
            URLQueryItem(name: "scope", value: Self.scope),
            URLQueryItem(name: "resource", value: config.resource),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "code_challenge", value: Self.challenge(verifier)),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
        ]
        await MainActor.run { _ = NSWorkspace.shared.open(components.url!) }

        let callback = try await withThrowingTaskGroup(of: URL.self) { group in
            group.addTask { try await redirect.callback() }
            group.addTask {
                try await Task.sleep(for: .seconds(300))
                throw URLError(.timedOut)
            }
            defer { group.cancelAll() }
            return try await group.next()!
        }
        let query = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? { query.first { $0.name == name }?.value }
        if let error = value("error") { throw GrantRefused(code: error) }
        guard value("state") == state, let code = value("code") else { throw URLError(.badServerResponse) }

        let tokens = try await tokenRequest(config.issuer, [
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect.redirectURI,
            "client_id": config.clientId,
            "code_verifier": verifier,
            "resource": config.resource,
        ])
        guard let refresh = tokens.refreshToken else { throw URLError(.userAuthenticationRequired) }
        try persist(Session(config: config, refreshToken: refresh))
        accessToken = (tokens.accessToken, .now.addingTimeInterval(tokens.expiresIn))
    }

    func cancelSignIn() {
        pending?.cancel()
        pending = nil
    }

    func signOut() {
        session = nil
        accessToken = nil
        Keychain.delete(service: Self.service, account: "session")
    }

    func token() async throws -> String {
        if let accessToken, accessToken.expiresAt.timeIntervalSinceNow > 30 { return accessToken.value }
        if let refreshing { return try await refreshing.value }
        guard let current = session else { throw NotSignedIn() }
        let task = Task { try await refresh(current) }
        refreshing = task
        defer { refreshing = nil }
        return try await task.value
    }

    private func refresh(_ current: Session) async throws -> String {
        do {
            let tokens = try await tokenRequest(current.config.issuer, [
                "grant_type": "refresh_token",
                "refresh_token": current.refreshToken,
                "client_id": current.config.clientId,
                "resource": current.config.resource,
            ])
            // Rotated server-side; keeping the old one would make the next
            // refresh a sign-out.
            try persist(Session(config: current.config, refreshToken: tokens.refreshToken ?? current.refreshToken))
            accessToken = (tokens.accessToken, .now.addingTimeInterval(tokens.expiresIn))
            return tokens.accessToken
        } catch let refused as GrantRefused where ["invalid_grant", "invalid_client"].contains(refused.code) {
            signOut()
            throw refused
        }
    }

    private func tokenRequest(_ issuer: String, _ params: [String: String]) async throws -> TokenResponse {
        var request = URLRequest(url: URL(string: "\(issuer)/oauth2/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var body = URLComponents()
        body.queryItems = params.map { URLQueryItem(name: $0.key, value: $0.value) }
        request.httpBody = Data((body.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B").utf8)
        do {
            return try HTTP.decoder.decode(TokenResponse.self, from: try await HTTP.data(request))
        } catch let failure as HTTP.Failure {
            if let error = try? HTTP.decoder.decode(OAuthError.self, from: Data(failure.body.utf8)) {
                throw GrantRefused(code: error.error)
            }
            throw failure
        }
    }

    private func persist(_ next: Session) throws {
        session = next
        try Keychain.write(try JSONEncoder().encode(next), service: Self.service, account: "session")
    }

    private static func randomURLSafe(_ bytes: Int) -> String {
        var data = Data(count: bytes)
        _ = data.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, bytes, $0.baseAddress!) }
        return base64URL(data)
    }

    private static func challenge(_ verifier: String) -> String {
        base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
