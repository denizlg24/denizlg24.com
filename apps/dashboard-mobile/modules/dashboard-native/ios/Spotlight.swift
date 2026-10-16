import CoreSpotlight
import Foundation
import UniformTypeIdentifiers

struct SpotlightEntry: Decodable {
  let id: String
  let title: String
  let description: String?
  let url: String
}

/// Titles, one line and a deep link per item — never a note body or mail.
/// One domain is replaced whole on every sync, so a deleted note leaves too.
enum Spotlight {
  static let domains = ["notes", "contacts", "courses"]

  static func replace(domain: String, json: String) async throws {
    guard let data = json.data(using: .utf8) else { return }
    let entries = try JSONDecoder().decode([SpotlightEntry].self, from: data)
    let index = CSSearchableIndex.default()
    try await index.deleteSearchableItems(withDomainIdentifiers: [domain])
    let items = entries.map { entry in
      let attributes = CSSearchableItemAttributeSet(contentType: .text)
      attributes.title = entry.title
      attributes.contentDescription = entry.description
      attributes.contentURL = URL(string: entry.url)
      return CSSearchableItem(
        uniqueIdentifier: entry.url, domainIdentifier: domain, attributeSet: attributes)
    }
    if !items.isEmpty { try await index.indexSearchableItems(items) }
  }

  static func clear() async {
    try? await CSSearchableIndex.default().deleteSearchableItems(withDomainIdentifiers: domains)
  }
}
