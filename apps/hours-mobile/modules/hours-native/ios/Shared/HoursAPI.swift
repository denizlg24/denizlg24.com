import Foundation

public enum ClockAction: String {
  case clockIn = "in"
  case clockOut = "out"
  case startBreak = "break"
  case resume = "resume"
}

/// The admin API calls the extension and the intents make on their own.
public enum HoursAPI {
  private static func send(_ path: String, method: String, body: [String: Any]?, token: String)
    async throws -> (Data, Int)
  {
    var request = URLRequest(url: HoursShared.site.appendingPathComponent("api/admin/\(path)"))
    request.httpMethod = method
    request.timeoutInterval = 20
    request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
    request.setValue(HoursShared.installationId, forHTTPHeaderField: "x-mobile-installation")
    if let body {
      request.setValue("application/json", forHTTPHeaderField: "content-type")
      request.httpBody = try JSONSerialization.data(withJSONObject: body)
    }
    let (data, response) = try await URLSession.shared.data(for: request)
    return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
  }

  public static func request(_ path: String, method: String = "GET", body: [String: Any]? = nil)
    async throws -> Data
  {
    let token = try await SessionTokens.shared.accessToken()
    var (data, status) = try await send(path, method: method, body: body, token: token)
    if status == 401 {
      let retried = try await SessionTokens.shared.accessToken(rejected: token)
      (data, status) = try await send(path, method: method, body: body, token: retried)
    }
    guard (200..<300).contains(status) else {
      let message =
        ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["error"] as? String
      throw HoursError.server(status, message ?? "Request failed (\(status))")
    }
    return data
  }

  /// Fetches the overview, keeps it for every process, and returns its snapshot.
  @discardableResult
  public static func refreshOverview() async throws -> HoursSnapshot {
    let data = try await request("hours")
    guard let overview = try? JSONDecoder().decode(Overview.self, from: data) else {
      throw HoursError.unreadable
    }
    let now = Date()
    OverviewStore.save(data, at: now)
    return overview.snapshot(at: now)
  }

  public static func clock(_ action: ClockAction, jobId: String? = nil) async throws {
    var body: [String: Any] = ["action": action.rawValue]
    if let jobId { body["jobId"] = jobId }
    _ = try await request("hours/clock", method: "POST", body: body)
  }
}
