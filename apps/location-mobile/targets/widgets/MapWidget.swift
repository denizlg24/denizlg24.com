import MapKit
import SwiftUI
import WidgetKit

struct MapEntry: TimelineEntry {
  let date: Date
  let snapshot: ExploreSnapshot
  /// Light and dark renders; nil when there is nothing to frame.
  let light: UIImage?
  let dark: UIImage?
}

/// The latest walk on Apple Maps, rendered in the extension with
/// `MKMapSnapshotter`, once per appearance. Reloaded by the app; between
/// reloads it keeps the last render.
struct MapProvider: TimelineProvider {
  func placeholder(in context: Context) -> MapEntry {
    MapEntry(date: Date(), snapshot: .empty, light: nil, dark: nil)
  }

  func getSnapshot(in context: Context, completion: @escaping (MapEntry) -> Void) {
    Task { completion(await entry(size: context.displaySize)) }
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<MapEntry>) -> Void) {
    Task {
      let entry = await entry(size: context.displaySize)
      completion(Timeline(entries: [entry], policy: .never))
    }
  }

  private func entry(size: CGSize) async -> MapEntry {
    let snapshot = ExploreStore.read()
    let coordinates = snapshot.coordinates
    guard !coordinates.isEmpty, size.width > 0 else {
      return MapEntry(date: Date(), snapshot: snapshot, light: nil, dark: nil)
    }
    async let light = MapRender.image(coordinates, size: size, style: .light)
    async let dark = MapRender.image(coordinates, size: size, style: .dark)
    return MapEntry(date: Date(), snapshot: snapshot, light: await light, dark: await dark)
  }
}

enum MapRender {
  static func image(
    _ coordinates: [CLLocationCoordinate2D], size: CGSize, style: UIUserInterfaceStyle
  ) async -> UIImage? {
    let options = MKMapSnapshotter.Options()
    options.size = size
    options.region = region(coordinates)
    options.traitCollection = UITraitCollection(userInterfaceStyle: style)
    let configuration = MKStandardMapConfiguration(emphasisStyle: .muted)
    configuration.pointOfInterestFilter = .excludingAll
    options.preferredConfiguration = configuration
    guard let shot = try? await MKMapSnapshotter(options: options).start() else { return nil }

    let traits = UITraitCollection(userInterfaceStyle: style)
    let label = UIColor(light: 0x303630, dark: 0xF1F3E0).resolvedColor(with: traits)
    return UIGraphicsImageRenderer(size: size).image { context in
      shot.image.draw(at: .zero)
      let cg = context.cgContext
      let points = coordinates.map { shot.point(for: $0) }
      cg.setLineCap(.round)
      cg.setLineJoin(.round)
      if points.count > 1 {
        cg.setStrokeColor(label.cgColor)
        cg.setLineWidth(3.5)
        cg.addLines(between: points)
        cg.strokePath()
      }
      if let last = points.last {
        let dot = CGRect(x: last.x - 5, y: last.y - 5, width: 10, height: 10)
        cg.setFillColor(UIColor(hex: 0xA1BC98).cgColor)
        cg.fillEllipse(in: dot)
        cg.setStrokeColor(label.cgColor)
        cg.setLineWidth(2)
        cg.strokeEllipse(in: dot)
      }
    }
  }

  /// The trail's bounds with a margin, never tighter than a few hundred metres.
  private static func region(_ coordinates: [CLLocationCoordinate2D]) -> MKCoordinateRegion {
    let latitudes = coordinates.map(\.latitude)
    let longitudes = coordinates.map(\.longitude)
    let south = latitudes.min() ?? 0
    let north = latitudes.max() ?? 0
    let west = longitudes.min() ?? 0
    let east = longitudes.max() ?? 0
    let center = CLLocationCoordinate2D(latitude: (south + north) / 2, longitude: (west + east) / 2)
    let minimum = 0.004
    return MKCoordinateRegion(
      center: center,
      span: MKCoordinateSpan(
        latitudeDelta: max((north - south) * 1.35, minimum),
        longitudeDelta: max((east - west) * 1.35, minimum)))
  }
}

struct MapWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "LocationMap", provider: MapProvider()) { entry in
      MapWidgetView(entry: entry)
        .foregroundStyle(Color.themeLabel)
        .containerBackground(for: .widget) {
          MapBackground(entry: entry)
        }
        .widgetURL(URL(string: "location://map"))
    }
    .configurationDisplayName("Map")
    .description("The latest walk.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    .contentMarginsDisabled()
  }
}

struct MapBackground: View {
  @Environment(\.colorScheme) private var scheme
  let entry: MapEntry

  var body: some View {
    if let image = scheme == .dark ? entry.dark : entry.light {
      Image(uiImage: image).resizable().scaledToFill()
    } else {
      Color.themeBackground
    }
  }
}

struct MapWidgetView: View {
  let entry: MapEntry

  var body: some View {
    VStack(alignment: .leading) {
      Spacer(minLength: 0)
      if entry.light == nil && entry.dark == nil {
        Text("—").font(.figure(22)).foregroundStyle(.tertiary)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        HStack(spacing: 6) {
          Circle()
            .fill(entry.snapshot.exploring ? Color.themeAccent : Color.themeSecondary.opacity(0.5))
            .frame(width: 7, height: 7)
          Text(ExploreFormat.distance(entry.snapshot.distanceMetres))
            .font(.figure(13))
          if entry.snapshot.exploring, let startedAt = entry.snapshot.startedAt {
            Text(startedAt, style: .timer)
              .font(.figure(12, weight: .regular))
              .foregroundStyle(.secondary)
          }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Color.themeBackground.opacity(0.88), in: Capsule())
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
  }
}
