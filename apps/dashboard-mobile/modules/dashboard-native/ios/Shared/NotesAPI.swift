import Foundation

/// Note capture outside the app: Siri, Shortcuts and the Share extension.
public enum NotesAPI {
  public struct Created {
    public let id: String
  }

  /// A URL becomes a link note (the server reads its title); anything else a
  /// text note titled by its first line.
  public static func create(text: String, url: String? = nil) async throws -> Created {
    var body: [String: Any] = [:]
    if let url {
      body["url"] = url
      if !text.isEmpty && text != url { body["content"] = text }
    } else {
      let firstLine = text.split(separator: "\n", maxSplits: 1).first.map(String.init) ?? text
      body["title"] = String(firstLine.prefix(120))
      body["content"] = text
    }
    let data = try await DashboardAPI.request("notes", method: "POST", body: body)
    guard
      let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let note = object["note"] as? [String: Any],
      let id = note["_id"] as? String
    else { throw DashboardError.unreadable }
    return Created(id: id)
  }

  /// Recomputes tags and groups, as every new note should get.
  public static func categorize(_ note: Created) async throws {
    _ = try await DashboardAPI.request("notes/\(note.id)/categorize", method: "POST", body: [:])
  }
}
