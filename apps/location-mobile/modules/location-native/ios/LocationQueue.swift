import Foundation

/// The wire shape of `locationPointInputSchema`.
struct QueuedPoint: Codable {
  let id: String
  let recordedAt: String
  let latitude: Double
  let longitude: Double
  let horizontalAccuracy: Double
  let altitude: Double?
  let verticalAccuracy: Double?
  let speed: Double?
  let course: Double?
  let source: String
}

/// The wire shape of `locationPlaceSchema`.
struct QueuedPlace: Codable {
  let name: String
  let category: String?
  let latitude: Double
  let longitude: Double
  let distanceMetres: Double

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(name, forKey: .name)
    try container.encode(category, forKey: .category)
    try container.encode(latitude, forKey: .latitude)
    try container.encode(longitude, forKey: .longitude)
    try container.encode(distanceMetres, forKey: .distanceMetres)
  }
}

/// The wire shape of `locationVisitInputSchema`. `departedAt` is sent as an
/// explicit null while the visit is open.
struct QueuedVisit: Codable {
  let id: String
  let arrivedAt: String
  let departedAt: String?
  let latitude: Double
  let longitude: Double
  let horizontalAccuracy: Double
  /// Nearest first; empty on a departure report, which the server leaves be.
  var places: [QueuedPlace] = []
  /// `visit` (CLVisit), `geofence` (a shop fence entered and stayed in) or `stop`.
  var source = "visit"

  enum CodingKeys: String, CodingKey {
    case id, arrivedAt, departedAt, latitude, longitude, horizontalAccuracy, places, source
  }

  init(
    id: String, arrivedAt: String, departedAt: String?, latitude: Double,
    longitude: Double, horizontalAccuracy: Double, places: [QueuedPlace] = [],
    source: String = "visit"
  ) {
    self.id = id
    self.arrivedAt = arrivedAt
    self.departedAt = departedAt
    self.latitude = latitude
    self.longitude = longitude
    self.horizontalAccuracy = horizontalAccuracy
    self.places = places
    self.source = source
  }

  /// Queue files written before places existed have no `places` key; the
  /// synthesized decoder would reject them and drop the whole queue.
  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    id = try container.decode(String.self, forKey: .id)
    arrivedAt = try container.decode(String.self, forKey: .arrivedAt)
    departedAt = try container.decodeIfPresent(String.self, forKey: .departedAt)
    latitude = try container.decode(Double.self, forKey: .latitude)
    longitude = try container.decode(Double.self, forKey: .longitude)
    horizontalAccuracy = try container.decode(Double.self, forKey: .horizontalAccuracy)
    places = try container.decodeIfPresent([QueuedPlace].self, forKey: .places) ?? []
    source = try container.decodeIfPresent(String.self, forKey: .source) ?? "visit"
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(id, forKey: .id)
    try container.encode(places, forKey: .places)
    try container.encode(arrivedAt, forKey: .arrivedAt)
    try container.encode(departedAt, forKey: .departedAt)
    try container.encode(latitude, forKey: .latitude)
    try container.encode(longitude, forKey: .longitude)
    try container.encode(horizontalAccuracy, forKey: .horizontalAccuracy)
    try container.encode(source, forKey: .source)
  }
}

private struct Batch: Encodable {
  let installationId: String
  let points: [QueuedPoint]
  let visits: [QueuedVisit]
}

private struct Pending: Codable {
  var points: [QueuedPoint] = []
  /// Keyed by id: a visit's departure report replaces its arrival report.
  var visits: [String: QueuedVisit] = [:]
}

struct UploadStatus {
  var pendingPoints: Int
  var pendingVisits: Int
  var lastUploadAt: Date?
  var lastError: String?
}

/// Everything recorded and not yet acknowledged by the server, on disk so a
/// relaunch, a crash or a day without signal loses nothing. Uploads are
/// idempotent on the ids, so a batch whose response was lost is sent again.
actor LocationQueue {
  static let shared = LocationQueue()

  /// Bounds the file while signed out or offline for weeks; the oldest go.
  private static let maxPoints = 50_000
  private static let pointsPerBatch = 1_000
  private static let visitsPerBatch = 100
  /// Points alone wait until this many collect or this long passes; a visit
  /// is sent at once, since it is what the in-store message reacts to.
  private static let flushPointCount = 50
  private static let flushInterval: TimeInterval = 300
  private static let eagerPointCount = 5
  private static let eagerInterval: TimeInterval = 10

  private var pending = Pending()
  private var loaded = false
  private var flushing = false
  private var lastUploadAt: Date?
  private var lastAttemptAt: Date?
  private var lastError: String?

  private static var fileURL: URL {
    let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory.appendingPathComponent("location-queue.json")
  }

  private func load() {
    guard !loaded else { return }
    loaded = true
    if let data = try? Data(contentsOf: Self.fileURL),
      let stored = try? JSONDecoder().decode(Pending.self, from: data)
    {
      pending = stored
    }
  }

  private func save() {
    guard let data = try? JSONEncoder().encode(pending) else { return }
    try? data.write(to: Self.fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
  }

  func add(point: QueuedPoint) {
    load()
    pending.points.append(point)
    if pending.points.count > Self.maxPoints {
      pending.points.removeFirst(pending.points.count - Self.maxPoints)
    }
    save()
  }

  func add(visit: QueuedVisit) {
    load()
    if let queued = pending.visits[visit.id], queued.departedAt != nil, visit.departedAt == nil {
      return
    }
    pending.visits[visit.id] = visit
    save()
  }

  func status() -> UploadStatus {
    load()
    return UploadStatus(
      pendingPoints: pending.points.count,
      pendingVisits: pending.visits.count,
      lastUploadAt: lastUploadAt,
      lastError: lastError
    )
  }

  /// `eager` while exploring: the trail reaches the server within seconds.
  func isDue(eager: Bool) -> Bool {
    load()
    if !pending.visits.isEmpty { return true }
    guard !pending.points.isEmpty else { return false }
    if pending.points.count >= (eager ? Self.eagerPointCount : Self.flushPointCount) {
      return true
    }
    guard let lastAttemptAt else { return true }
    return Date().timeIntervalSince(lastAttemptAt)
      >= (eager ? Self.eagerInterval : Self.flushInterval)
  }

  /// Sends everything pending, a batch at a time, until empty or a failure.
  func flush(installationId: String, site: URL) async {
    load()
    guard !flushing else { return }
    flushing = true
    defer { flushing = false }
    while !pending.points.isEmpty || !pending.visits.isEmpty {
      lastAttemptAt = Date()
      let points = Array(pending.points.prefix(Self.pointsPerBatch))
      let visits = Array(pending.visits.values.prefix(Self.visitsPerBatch))
      var rejection: String?
      do {
        let body = try JSONEncoder().encode(
          Batch(installationId: installationId, points: points, visits: visits))
        try await Self.post(body, site: site)
      } catch LocationError.server(400, let message) {
        // Resending a batch the server finds invalid would block every batch
        // behind it forever; it is dropped and the reason kept.
        rejection = "Rejected: \(message)"
      } catch {
        lastError = error.localizedDescription
        return
      }
      let sentPoints = Set(points.map(\.id))
      pending.points.removeAll { sentPoints.contains($0.id) }
      for visit in visits where pending.visits[visit.id]?.departedAt == visit.departedAt {
        pending.visits.removeValue(forKey: visit.id)
      }
      save()
      if let rejection {
        lastError = rejection
      } else {
        lastUploadAt = Date()
        lastError = nil
      }
    }
  }

  private static func send(_ body: Data, site: URL, token: String) async throws -> (Data, Int) {
    var request = URLRequest(url: site.appendingPathComponent("api/admin/location/batch"))
    request.httpMethod = "POST"
    request.timeoutInterval = 30
    request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.httpBody = body
    let (data, response) = try await URLSession.shared.data(for: request)
    return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
  }

  private static func post(_ body: Data, site: URL) async throws {
    let token = try await SessionTokens.shared.accessToken()
    var (data, status) = try await send(body, site: site, token: token)
    if status == 401 {
      let retried = try await SessionTokens.shared.accessToken(rejected: token)
      (data, status) = try await send(body, site: site, token: retried)
    }
    guard (200..<300).contains(status) else {
      let message =
        ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["error"] as? String
      throw LocationError.server(status, message ?? "Upload failed (\(status))")
    }
  }
}
