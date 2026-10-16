import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Saves what was shared as a note: a link (the server reads its title), a
/// piece of text, or an image uploaded to storage first. Every new note is
/// categorized, as one made anywhere else is.
final class ShareViewController: UIViewController {
  private let state = ShareState()

  override func viewDidLoad() {
    super.viewDidLoad()
    let host = UIHostingController(rootView: ShareView(state: state) { [weak self] in
      self?.finish()
    })
    addChild(host)
    host.view.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(host.view)
    NSLayoutConstraint.activate([
      host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      host.view.topAnchor.constraint(equalTo: view.topAnchor),
      host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
    host.didMove(toParent: self)
    Task { await save() }
  }

  private func finish() {
    extensionContext?.completeRequest(returningItems: nil)
  }

  private func providers() -> [NSItemProvider] {
    (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
      .flatMap { $0.attachments ?? [] }
  }

  @MainActor
  private func save() async {
    guard SessionKeychain.read() != nil else {
      state.phase = .failed("Open Dashboard to sign in.")
      return
    }
    do {
      let note = try await createNote(from: providers())
      try? await NotesAPI.categorize(note)
      state.phase = .saved
      try? await Task.sleep(for: .milliseconds(700))
      finish()
    } catch {
      state.phase = .failed(error.localizedDescription)
    }
  }

  private func createNote(from providers: [NSItemProvider]) async throws -> NotesAPI.Created {
    if let provider = providers.first(where: {
      $0.hasItemConformingToTypeIdentifier(UTType.url.identifier)
    }), let url = try await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL,
      url.scheme?.hasPrefix("http") == true
    {
      return try await NotesAPI.create(text: url.absoluteString, url: url.absoluteString)
    }
    if let provider = providers.first(where: {
      $0.hasItemConformingToTypeIdentifier(UTType.image.identifier)
    }) {
      let data = try await imageData(provider)
      let uploaded = try await DashboardAPI.upload(
        data, filename: "shared-\(Int(Date().timeIntervalSince1970)).jpg", mimeType: "image/jpeg")
      let title = "Image \(Date().formatted(date: .abbreviated, time: .shortened))"
      return try await NotesAPI.create(text: "\(title)\n\n![](\(uploaded))")
    }
    if let provider = providers.first(where: {
      $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier)
    }), let text = try await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier)
      as? String
    {
      let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
      if let url = URL(string: trimmed), url.scheme?.hasPrefix("http") == true,
        !trimmed.contains(" ")
      {
        return try await NotesAPI.create(text: trimmed, url: trimmed)
      }
      return try await NotesAPI.create(text: trimmed)
    }
    throw DashboardError.server(0, "Nothing to save.")
  }

  /// Any image type, re-encoded as a bounded JPEG so a 48 MP photo is not
  /// pushed over a phone connection whole.
  private func imageData(_ provider: NSItemProvider) async throws -> Data {
    let item = try await provider.loadItem(forTypeIdentifier: UTType.image.identifier)
    let image: UIImage?
    switch item {
    case let url as URL: image = UIImage(contentsOfFile: url.path)
    case let data as Data: image = UIImage(data: data)
    case let picture as UIImage: image = picture
    default: image = nil
    }
    guard let image else { throw DashboardError.unreadable }
    let longest = max(image.size.width, image.size.height)
    let scale = min(1, 2_400 / max(longest, 1))
    let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    let resized = UIGraphicsImageRenderer(size: size).image { _ in
      image.draw(in: CGRect(origin: .zero, size: size))
    }
    guard let jpeg = resized.jpegData(compressionQuality: 0.82) else {
      throw DashboardError.unreadable
    }
    return jpeg
  }
}

@MainActor
final class ShareState: ObservableObject {
  enum Phase: Equatable {
    case saving
    case saved
    case failed(String)
  }

  @Published var phase: Phase = .saving
}

struct ShareView: View {
  @ObservedObject var state: ShareState
  let done: () -> Void

  var body: some View {
    VStack(spacing: 14) {
      switch state.phase {
      case .saving:
        ProgressView()
      case .saved:
        Image(systemName: "checkmark.circle.fill").font(.system(size: 34))
        Text("Saved").font(.headline)
      case .failed(let message):
        Image(systemName: "exclamationmark.circle").font(.system(size: 34))
          .foregroundStyle(.red)
        Text(message).font(.subheadline).multilineTextAlignment(.center)
        Button("Done", action: done).buttonStyle(.bordered)
      }
    }
    .padding(24)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(.background)
  }
}
