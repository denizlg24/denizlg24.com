import AppIntents
import Foundation

struct SeatEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Claude Seat"
    static let defaultQuery = SeatQuery()

    let id: String
    let title: String
    let email: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: "\(email)")
    }

    init(_ seat: ClaudeSeat) {
        id = seat.id
        title = seat.title
        email = seat.email
    }
}

struct SeatQuery: EntityQuery {
    @MainActor
    func entities(for identifiers: [String]) async throws -> [SeatEntity] {
        AppModel.shared.claude.seats.filter { identifiers.contains($0.id) }.map(SeatEntity.init)
    }

    @MainActor
    func suggestedEntities() async throws -> [SeatEntity] {
        AppModel.shared.claude.seats.map(SeatEntity.init)
    }
}

struct SwitchSeatIntent: AppIntent {
    static let title: LocalizedStringResource = "Switch Claude Seat"
    static let description = IntentDescription("Points Claude Code at another seat.")

    @Parameter(title: "Seat")
    var seat: SeatEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Switch Claude Code to \(\.$seat)")
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let model = AppModel.shared
        await model.switchSeat(to: seat.id)
        if let error = model.switchError { throw IntentError(message: error) }
        return .result(dialog: "Claude Code is on \(seat.title).")
    }
}

struct SwitchToFreshestSeatIntent: AppIntent {
    static let title: LocalizedStringResource = "Switch to Freshest Claude Seat"
    static let description = IntentDescription("Points Claude Code at the seat with the most usage left.")

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let model = AppModel.shared
        await model.claude.refreshUsage()
        guard let best = model.claude.bestAlternative else {
            return .result(dialog: "No other seat to switch to.")
        }
        await model.switchSeat(to: best.id)
        if let error = model.switchError { throw IntentError(message: error) }
        return .result(dialog: "Claude Code is on \(best.title), \(Format.percent(best.usage?.headroom ?? 0)) left.")
    }
}

struct IntentError: Error, CustomLocalizedStringResourceConvertible {
    let message: String
    var localizedStringResource: LocalizedStringResource { "\(message)" }
}

struct TallyShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: SwitchToFreshestSeatIntent(),
            phrases: ["Switch to the freshest Claude seat in \(.applicationName)"],
            shortTitle: "Freshest Seat",
            systemImageName: "arrow.triangle.swap"
        )
        AppShortcut(
            intent: SwitchSeatIntent(),
            phrases: ["Switch Claude seat in \(.applicationName)"],
            shortTitle: "Switch Seat",
            systemImageName: "person.2"
        )
    }
}
