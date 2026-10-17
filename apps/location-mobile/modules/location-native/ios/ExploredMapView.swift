import ExpoModulesCore
import MapKit

/// Explored ground on Apple Maps: every walked street as a band a fixed
/// number of metres wide, so it reads as ground covered at any zoom, the way
/// the desktop's explored map draws it. The session being walked now sits
/// on top in the label colour.
final class ExploredMapView: ExpoView, MKMapViewDelegate {
  private let map = MKMapView()
  private var explored: MKMultiPolyline?
  private var session: MKPolyline?
  private var framedKey: Int?

  /// Half the band's width, in metres.
  var radiusMetres: Double = 10 {
    didSet { if oldValue != radiusMetres { redraw() } }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    let configuration = MKStandardMapConfiguration(emphasisStyle: .muted)
    configuration.pointOfInterestFilter = .excludingAll
    map.preferredConfiguration = configuration
    map.showsUserLocation = true
    map.showsCompass = false
    map.pointOfInterestFilter = .excludingAll
    map.delegate = self
    addSubview(map)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    map.frame = bounds
    // A frame asked for before the first layout had no size to fit into.
    frame(mode: frameMode, key: frameKey)
  }

  var tracks: [[Double]] = []
  var spots: [[Double]] = []
  var sessionTrail: [Double] = []
  var frameMode = "all"
  var frameKey = 0
  private var drawn: (tracks: [[Double]], spots: [[Double]], session: [Double])?

  /// Called once per batch of prop changes.
  func update() {
    if drawn?.tracks != tracks || drawn?.spots != spots { setTracks(tracks, spots: spots) }
    if drawn?.session != sessionTrail { setSession(sessionTrail) }
    drawn = (tracks, spots, sessionTrail)
    frame(mode: frameMode, key: frameKey)
  }

  /// Flat `[lon, lat, lon, lat, …]` per track, the server's explored shape.
  private func setTracks(_ tracks: [[Double]], spots: [[Double]]) {
    let lines = tracks.compactMap { Self.polyline(flat: $0) }
      + spots.compactMap { spot -> MKPolyline? in
        // A zero-length line with a round cap is a dot of the band's width.
        guard spot.count == 2 else { return nil }
        return Self.polyline(flat: [spot[0], spot[1], spot[0], spot[1]])
      }
    if let explored { map.removeOverlay(explored) }
    explored = lines.isEmpty ? nil : MKMultiPolyline(lines)
    if let explored { map.insertOverlay(explored, at: 0, level: .aboveRoads) }
  }

  private func setSession(_ flat: [Double]) {
    if let session { map.removeOverlay(session) }
    session = Self.polyline(flat: flat)
    if let session { map.addOverlay(session, level: .aboveRoads) }
  }

  /// Frames the map once per `key`: `session` on the walk being recorded, else
  /// everything explored, else the user.
  private func frame(mode: String, key: Int) {
    guard key != framedKey, bounds.width > 0 else { return }
    framedKey = key
    let padding = UIEdgeInsets(top: 60, left: 40, bottom: 120, right: 40)
    let target: MKOverlay? =
      mode == "session" ? (session ?? explored) : mode == "all" ? (explored ?? session) : nil
    if let target, target.boundingMapRect.size.width > 0 || target.boundingMapRect.size.height > 0 {
      map.setVisibleMapRect(target.boundingMapRect, edgePadding: padding, animated: true)
    } else if let location = map.userLocation.location {
      map.setRegion(
        MKCoordinateRegion(
          center: location.coordinate, latitudinalMeters: 1_200, longitudinalMeters: 1_200),
        animated: true)
    } else {
      map.setUserTrackingMode(.follow, animated: true)
    }
  }

  private func redraw() {
    for overlay in map.overlays { map.renderer(for: overlay)?.setNeedsDisplay() }
  }

  private static func polyline(flat: [Double]) -> MKPolyline? {
    guard flat.count >= 4 else { return nil }
    var coordinates: [CLLocationCoordinate2D] = []
    coordinates.reserveCapacity(flat.count / 2)
    var index = 0
    while index + 1 < flat.count {
      coordinates.append(CLLocationCoordinate2D(latitude: flat[index + 1], longitude: flat[index]))
      index += 2
    }
    return MKPolyline(coordinates: coordinates, count: coordinates.count)
  }

  func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
    if let multi = overlay as? MKMultiPolyline {
      let renderer = MetricMultiPolylineRenderer(multiPolyline: multi)
      renderer.radiusMetres = radiusMetres
      renderer.strokeColor = ExploreColors.explored
      return renderer
    }
    if let line = overlay as? MKPolyline {
      let renderer = MetricPolylineRenderer(polyline: line)
      renderer.radiusMetres = max(3, radiusMetres / 2)
      renderer.strokeColor = ExploreColors.session
      return renderer
    }
    return MKOverlayRenderer(overlay: overlay)
  }
}

/// `packages/ui/src/theme.css`: explored ground in the accent, the walk in progress in the label colour.
enum ExploreColors {
  static let explored = UIColor { traits in
    UIColor(red: 0.631, green: 0.737, blue: 0.596, alpha: traits.userInterfaceStyle == .dark ? 0.8 : 0.85)
  }
  static let session = UIColor { traits in
    traits.userInterfaceStyle == .dark
      ? UIColor(red: 0.945, green: 0.953, blue: 0.878, alpha: 1)
      : UIColor(red: 0.188, green: 0.212, blue: 0.188, alpha: 1)
  }
}

/// A stroke `2 × radius` metres wide in map points, never thinner than two screen points.
private func applyMetricWidth(
  _ context: CGContext, radiusMetres: Double, rect: MKMapRect, zoomScale: MKZoomScale
) {
  let latitude = rect.origin.coordinate.latitude
  let metric = 2 * radiusMetres * MKMapPointsPerMeterAtLatitude(latitude)
  context.setLineWidth(max(metric, 2 / zoomScale))
  context.setLineCap(.round)
  context.setLineJoin(.round)
}

final class MetricMultiPolylineRenderer: MKMultiPolylineRenderer {
  var radiusMetres: Double = 10

  override func applyStrokeProperties(to context: CGContext, atZoomScale zoomScale: MKZoomScale) {
    super.applyStrokeProperties(to: context, atZoomScale: zoomScale)
    applyMetricWidth(
      context, radiusMetres: radiusMetres, rect: overlay.boundingMapRect, zoomScale: zoomScale)
  }
}

final class MetricPolylineRenderer: MKPolylineRenderer {
  var radiusMetres: Double = 5

  override func applyStrokeProperties(to context: CGContext, atZoomScale zoomScale: MKZoomScale) {
    super.applyStrokeProperties(to: context, atZoomScale: zoomScale)
    applyMetricWidth(
      context, radiusMetres: radiusMetres, rect: overlay.boundingMapRect, zoomScale: zoomScale)
  }
}
