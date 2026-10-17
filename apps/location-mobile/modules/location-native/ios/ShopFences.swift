import CoreLocation
import MapKit
import UIKit

/// A shop with a fence around it: the place the arrival is reported at.
struct FencedShop: Codable {
  let name: String
  let category: String?
  let latitude: Double
  let longitude: Double

  var location: CLLocation { CLLocation(latitude: latitude, longitude: longitude) }
}

/// Geofences around the shops nearby that he has bought from.
///
/// CoreLocation's visits miss most shop stops — a five-minute Lidl run is
/// rarely a "visit" — and a region crossing is reported within a minute or
/// two, relaunching the app if it was terminated. The merchant words come
/// from the server (`GET /location/merchants`, his card history); the shops
/// from Apple Maps around wherever he is, re-searched every few hundred
/// metres. iOS allows twenty regions per app; eighteen are used.
final class ShopFences {
  static let regionPrefix = "shop:"
  static let radius: CLLocationDistance = 80

  private static let maxRegions = 18
  private static let searchRadius: CLLocationDistance = 1_500
  private static let refreshDistance: CLLocationDistance = 600
  private static let refreshAge: TimeInterval = 6 * 3_600
  private static let merchantsAge: TimeInterval = 12 * 3_600
  private static let categories: [MKPointOfInterestCategory] = [
    .foodMarket, .store, .pharmacy, .bakery, .cafe, .restaurant, .gasStation,
  ]

  private let defaults = UserDefaults.standard
  private var refreshing = false

  /// The fenced shops by region identifier, persisted for a relaunch that
  /// only has the region it was woken for.
  private(set) var shops: [String: FencedShop] {
    get {
      guard let data = defaults.data(forKey: "fencedShops"),
        let shops = try? JSONDecoder().decode([String: FencedShop].self, from: data)
      else { return [:] }
      return shops
    }
    set { defaults.set(try? JSONEncoder().encode(newValue), forKey: "fencedShops") }
  }

  func shop(for region: CLRegion) -> FencedShop? { shops[region.identifier] }

  /// Re-searches when he has moved far enough from the last search, or it is old.
  func refreshIfDue(around location: CLLocation, manager: CLLocationManager, site: URL) {
    guard !refreshing else { return }
    let lastAt = defaults.double(forKey: "fencesRefreshedAt")
    let lastCenter = CLLocation(
      latitude: defaults.double(forKey: "fencesLatitude"),
      longitude: defaults.double(forKey: "fencesLongitude"))
    let moved = lastAt == 0 || location.distance(from: lastCenter) >= Self.refreshDistance
    let stale = Date().timeIntervalSince1970 - lastAt >= Self.refreshAge
    guard moved || stale else { return }
    refreshing = true
    let task = UIApplication.shared.beginBackgroundTask(withName: "shop-fences")
    Task {
      defer {
        Task { @MainActor in
          self.refreshing = false
          UIApplication.shared.endBackgroundTask(task)
        }
      }
      let merchants = await self.merchants(site: site)
      guard !merchants.isEmpty else { return }
      let found = await Self.search(around: location.coordinate)
      let matched =
        found
        .filter { Self.names(merchants, $0.name) }
        .sorted { $0.location.distance(from: location) < $1.location.distance(from: location) }
        .prefix(Self.maxRegions)
      await MainActor.run {
        self.monitor(Array(matched), manager: manager)
        self.defaults.set(Date().timeIntervalSince1970, forKey: "fencesRefreshedAt")
        self.defaults.set(location.coordinate.latitude, forKey: "fencesLatitude")
        self.defaults.set(location.coordinate.longitude, forKey: "fencesLongitude")
      }
    }
  }

  func stopAll(manager: CLLocationManager) {
    for region in manager.monitoredRegions where region.identifier.hasPrefix(Self.regionPrefix) {
      manager.stopMonitoring(for: region)
    }
    shops = [:]
  }

  private func monitor(_ found: [FencedShop], manager: CLLocationManager) {
    var next: [String: FencedShop] = [:]
    for shop in found {
      let id = "\(Self.regionPrefix)\(shop.name)|\(shop.latitude),\(shop.longitude)"
      next[id] = shop
    }
    for region in manager.monitoredRegions
    where region.identifier.hasPrefix(Self.regionPrefix) && next[region.identifier] == nil {
      manager.stopMonitoring(for: region)
    }
    let monitored = Set(manager.monitoredRegions.map(\.identifier))
    for (id, shop) in next where !monitored.contains(id) {
      let region = CLCircularRegion(
        center: CLLocationCoordinate2D(latitude: shop.latitude, longitude: shop.longitude),
        radius: Self.radius, identifier: id)
      region.notifyOnEntry = true
      region.notifyOnExit = true
      manager.startMonitoring(for: region)
    }
    shops = next
  }

  // MARK: - Merchants

  private func merchants(site: URL) async -> [String] {
    let cachedAt = defaults.double(forKey: "merchantsFetchedAt")
    let cached = defaults.stringArray(forKey: "merchantTokens") ?? []
    if !cached.isEmpty, Date().timeIntervalSince1970 - cachedAt < Self.merchantsAge {
      return cached
    }
    guard let token = try? await SessionTokens.shared.accessToken() else { return cached }
    var request = URLRequest(url: site.appendingPathComponent("api/admin/location/merchants"))
    request.timeoutInterval = 20
    request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
    guard let (data, response) = try? await URLSession.shared.data(for: request),
      (response as? HTTPURLResponse)?.statusCode == 200,
      let body = try? JSONDecoder().decode(MerchantsResponse.self, from: data)
    else { return cached }
    defaults.set(body.tokens, forKey: "merchantTokens")
    defaults.set(Date().timeIntervalSince1970, forKey: "merchantsFetchedAt")
    return body.tokens
  }

  private struct MerchantsResponse: Decodable { let tokens: [String] }

  // MARK: - Shops

  private static func search(around center: CLLocationCoordinate2D) async -> [FencedShop] {
    await withTaskGroup(of: [FencedShop].self) { group in
      // One request per category: a single request caps its results, and in
      // a town centre the cap fills with cafés before the supermarkets.
      for category in categories {
        group.addTask {
          let request = MKLocalPointsOfInterestRequest(center: center, radius: searchRadius)
          request.pointOfInterestFilter = MKPointOfInterestFilter(including: [category])
          let items = (try? await MKLocalSearch(request: request).start())?.mapItems ?? []
          return items.compactMap { item in
            guard let name = item.name, !name.isEmpty else { return nil }
            let point = item.placemark.coordinate
            return FencedShop(
              name: name, category: item.pointOfInterestCategory?.rawValue,
              latitude: point.latitude, longitude: point.longitude)
          }
        }
      }
      var all: [String: FencedShop] = [:]
      for await batch in group {
        for shop in batch { all["\(shop.name)|\(shop.latitude),\(shop.longitude)"] = shop }
      }
      return Array(all.values)
    }
  }

  // MARK: - Names

  /// The server's matching (`placeTokens` / `placeNamesMerchant` in
  /// `apps/web/lib/location-brief.ts`): words of four letters or more, Danish
  /// letters in both spellings, a merchant word matched whole or by prefix.
  static func names(_ merchants: [String], _ name: String) -> Bool {
    let words = tokens(name)
    return merchants.contains { merchant in
      words.contains { merchant == $0 || merchant.hasPrefix($0) }
    }
  }

  static func tokens(_ name: String) -> Set<String> {
    let lower = name.lowercased()
    let folded = lower
      .replacingOccurrences(of: "ø", with: "o")
      .replacingOccurrences(of: "æ", with: "ae")
    let transliterated = lower
      .replacingOccurrences(of: "ø", with: "oe")
      .replacingOccurrences(of: "æ", with: "ae")
      .replacingOccurrences(of: "å", with: "aa")
    return Set([folded, transliterated].flatMap(words))
  }

  private static func words(_ text: String) -> [String] {
    let plain = text.folding(options: .diacriticInsensitive, locale: nil)
    var split = ""
    var previous: Character?
    for character in plain {
      if let previous, previous.isLetter != character.isLetter,
        previous.isNumber || character.isNumber
      {
        split.append(" ")
      }
      split.append(character)
      previous = character
    }
    return split
      .split { !($0.isLetter || $0.isNumber) || !$0.isASCII }
      .map(String.init)
      .filter { $0.count >= 4 && !$0.contains(where: \.isNumber) }
  }
}
