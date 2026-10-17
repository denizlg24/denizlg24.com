import AppIntents
import SwiftUI
import WidgetKit

@main
struct DashboardWidgetBundle: WidgetBundle {
  var body: some Widget {
    TodayWidget()
    BoardTodosWidget()
    NextClassWidget()
    BudgetWidget()
    WatchlistWidget()
  }
}

// MARK: - Timeline

struct TodayEntry: TimelineEntry {
  let date: Date
  let snapshot: TodaySnapshot
}

/// The stored Today payload, refetched once it is over ten minutes old. The
/// app writes a fresh one every time it loads Today, so the widgets mostly
/// draw what the phone last saw.
struct TodayProvider: TimelineProvider {
  func placeholder(in context: Context) -> TodayEntry {
    TodayEntry(date: Date(), snapshot: .preview)
  }

  func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
    if context.isPreview {
      completion(TodayEntry(date: Date(), snapshot: .preview))
      return
    }
    Task { completion(TodayEntry(date: Date(), snapshot: await TodayStore.current(maxAge: 10 * 60))) }
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
    Task {
      let snapshot = await TodayStore.current(maxAge: 10 * 60)
      let now = Date()
      // One entry per agenda boundary, so a finished class drops off on time.
      let boundaries = snapshot.payload.agenda
        .flatMap { [$0.startDate, $0.endDate] }
        .compactMap { $0 }
        .filter { $0 > now }
        .sorted()
        .prefix(8)
      let entries = [TodayEntry(date: now, snapshot: snapshot)]
        + boundaries.map { TodayEntry(date: $0, snapshot: snapshot) }
      let midnight = Calendar.current.startOfDay(for: now).addingTimeInterval(24 * 60 * 60)
      completion(
        Timeline(entries: entries, policy: .after(min(now.addingTimeInterval(30 * 60), midnight))))
    }
  }
}

extension TodaySnapshot {
  static let preview: TodaySnapshot = {
    let now = Date()
    let iso = ISO8601DateFormatter()
    let payload = TodayPayload(
      generatedAt: iso.string(from: now), day: "",
      agenda: [
        .init(
          id: "1", kind: "class", title: "Algorithms",
          start: iso.string(from: now.addingTimeInterval(1_800)),
          end: iso.string(from: now.addingTimeInterval(7_200)), allDay: false, place: "Aud. 2"),
        .init(
          id: "2", kind: "event", title: "Dentist",
          start: iso.string(from: now.addingTimeInterval(14_400)), end: nil, allDay: false,
          place: nil),
      ],
      counts: .init(
        triage: 3, actionNeeded: 1, unreadMail: 12, newContacts: 1, pendingComments: 0,
        budgetAlerts: 1),
      nextDeadline: .init(
        courseId: "c", courseName: "Algorithms", title: "Problem set 4",
        dueAt: iso.string(from: now.addingTimeInterval(86_400)), overdue: false),
      budget: .init(currency: "EUR", plannedMinor: 120_000, spentMinor: 74_000, availableMinor: 46_000),
      board: .init(
        whiteboardId: nil,
        todos: [
          .init(elementId: "l", itemId: "a", text: "Groceries", completed: false),
          .init(elementId: "l", itemId: "b", text: "Call the bank", completed: true),
        ]))
    return TodaySnapshot(payload: payload, fetchedAt: now, signedIn: true)
  }()
}

// MARK: - Shared views

/// `packages/ui/src/theme.css`: the page and emphasis colours, light and dark.
extension Color {
  static let themeBackground = Color(light: 0xF9F8F6, dark: 0x303630)
  static let themeLabel = Color(light: 0x303630, dark: 0xF1F3E0)

  init(light: UInt32, dark: UInt32) {
    self.init(
      uiColor: UIColor { traits in
        let hex = traits.userInterfaceStyle == .dark ? dark : light
        return UIColor(
          red: CGFloat((hex >> 16) & 0xFF) / 255,
          green: CGFloat((hex >> 8) & 0xFF) / 255,
          blue: CGFloat(hex & 0xFF) / 255,
          alpha: 1
        )
      }
    )
  }
}

extension Font {
  static func figure(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
    .system(size: size, weight: weight, design: .default).monospacedDigit()
  }
}

struct Eyebrow: View {
  let text: String

  var body: some View {
    Text(text.uppercased())
      .font(.system(size: 10, weight: .semibold))
      .tracking(0.8)
      .foregroundStyle(.secondary)
      .lineLimit(1)
  }
}

struct SignedOutView: View {
  var body: some View {
    Text("Open Dashboard to sign in.")
      .font(.system(size: 13))
      .foregroundStyle(.secondary)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

func clockText(_ date: Date?) -> String {
  date?.formatted(date: .omitted, time: .shortened) ?? ""
}

func money(_ minor: Int, _ currency: String) -> Text {
  Text(Double(minor) / 100, format: .currency(code: currency).precision(.fractionLength(0)))
}

struct AgendaLine: View {
  let item: TodayPayload.AgendaItem

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 6) {
      Text(item.allDay ? "All day" : clockText(item.startDate))
        .font(.figure(12, weight: .medium))
        .foregroundStyle(.secondary)
        .frame(width: 44, alignment: .leading)
      Text(item.title).font(.system(size: 13)).lineLimit(1)
    }
  }
}

// MARK: - Today

struct TodayWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "DashboardToday", provider: TodayProvider()) { entry in
      TodayWidgetView(entry: entry)
        .foregroundStyle(Color.themeLabel)
        .containerBackground(Color.themeBackground, for: .widget)
        .widgetURL(URL(string: "dashboard://today"))
    }
    .configurationDisplayName("Today")
    .description("Agenda and what is waiting.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular])
  }
}

struct TodayWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: TodayEntry

  var body: some View {
    if !entry.snapshot.signedIn {
      SignedOutView()
    } else {
      content
    }
  }

  private var upcoming: [TodayPayload.AgendaItem] {
    entry.snapshot.payload.upcoming(after: entry.date)
  }

  @ViewBuilder
  private var content: some View {
    let counts = entry.snapshot.payload.counts
    switch family {
    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 1) {
        if let first = upcoming.first {
          Text(first.allDay ? first.title : "\(clockText(first.startDate)) \(first.title)")
            .font(.system(size: 13, weight: .semibold)).lineLimit(1).widgetAccentable()
          ForEach(upcoming.dropFirst().prefix(2)) { item in
            Text("\(item.allDay ? "" : clockText(item.startDate) + " ")\(item.title)")
              .font(.system(size: 12)).lineLimit(1)
          }
        } else {
          Text("Nothing on").font(.system(size: 13))
        }
      }
    case .systemSmall:
      VStack(alignment: .leading, spacing: 4) {
        Eyebrow(text: entry.date.formatted(.dateTime.weekday(.wide)))
        if upcoming.isEmpty {
          Text("—").font(.figure(22)).foregroundStyle(.tertiary)
        }
        ForEach(upcoming.prefix(4)) { item in AgendaLine(item: item) }
        Spacer(minLength: 0)
        Text("\(counts.triage) triage · \(counts.unreadMail) unread")
          .font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    default:
      HStack(alignment: .top, spacing: 16) {
        VStack(alignment: .leading, spacing: 4) {
          Eyebrow(text: entry.date.formatted(.dateTime.weekday(.wide).day().month()))
          if upcoming.isEmpty {
            Text("—").font(.figure(22)).foregroundStyle(.tertiary)
          }
          ForEach(upcoming.prefix(family == .systemLarge ? 12 : 5)) { item in
            AgendaLine(item: item)
          }
          Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        VStack(alignment: .leading, spacing: 8) {
          CountLine(label: "Triage", value: counts.triage)
          CountLine(label: "Unread", value: counts.unreadMail)
          CountLine(label: "Contacts", value: counts.newContacts)
          CountLine(label: "Alerts", value: counts.budgetAlerts)
        }
        .frame(width: 70, alignment: .leading)
      }
    }
  }
}

struct CountLine: View {
  let label: String
  let value: Int

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Eyebrow(text: label)
      Text("\(value)")
        .font(.figure(17))
        .foregroundStyle(value == 0 ? .tertiary : .primary)
    }
  }
}

// MARK: - Board todos

struct BoardTodosWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "DashboardBoardTodos", provider: TodayProvider()) { entry in
      BoardTodosView(entry: entry)
        .foregroundStyle(Color.themeLabel)
        .containerBackground(Color.themeBackground, for: .widget)
        .widgetURL(URL(string: "dashboard://today"))
    }
    .configurationDisplayName("Board")
    .description("Today's todos.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

struct BoardTodosView: View {
  @Environment(\.widgetFamily) private var family
  let entry: TodayEntry

  private var limit: Int {
    switch family {
    case .systemLarge: return 11
    case .systemMedium: return 4
    default: return 4
    }
  }

  var body: some View {
    if !entry.snapshot.signedIn {
      SignedOutView()
    } else {
      // Open first, so the rows worth tapping are the ones that fit.
      let todos = entry.snapshot.payload.board.todos.sorted { !$0.completed && $1.completed }
      VStack(alignment: .leading, spacing: 6) {
        Eyebrow(text: "Board")
        if todos.isEmpty {
          Text("—").font(.figure(22)).foregroundStyle(.tertiary)
        }
        ForEach(todos.prefix(limit)) { todo in
          Button(
            intent: ToggleBoardTodoIntent(
              elementId: todo.elementId, itemId: todo.itemId, completed: !todo.completed)
          ) {
            HStack(spacing: 8) {
              Image(systemName: todo.completed ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(todo.completed ? .tertiary : .primary)
              Text(todo.text)
                .font(.system(size: 13))
                .strikethrough(todo.completed)
                .foregroundStyle(todo.completed ? .secondary : .primary)
                .lineLimit(1)
            }
          }
          .buttonStyle(.plain)
        }
        Spacer(minLength: 0)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

// MARK: - Next class

struct NextClassWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "DashboardNextClass", provider: TodayProvider()) { entry in
      NextClassView(entry: entry)
        .foregroundStyle(Color.themeLabel)
        .containerBackground(Color.themeBackground, for: .widget)
        .widgetURL(URL(string: "dashboard://calendar"))
    }
    .configurationDisplayName("Next class")
    .description("The next class today and the next deadline.")
    .supportedFamilies([.systemSmall, .accessoryRectangular, .accessoryInline])
  }
}

struct NextClassView: View {
  @Environment(\.widgetFamily) private var family
  let entry: TodayEntry

  var body: some View {
    let next = entry.snapshot.payload.nextClass(after: entry.date)
    let deadline = entry.snapshot.payload.nextDeadline
    switch family {
    case .accessoryInline:
      if let next {
        Text("\(clockText(next.startDate)) \(next.title)")
      } else if let deadline {
        Text("Due: \(deadline.title)")
      } else {
        Text("No more classes")
      }
    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 1) {
        if let next {
          Text(next.title).font(.system(size: 13, weight: .semibold)).lineLimit(1)
            .widgetAccentable()
          Text("\(clockText(next.startDate))–\(clockText(next.endDate))\(next.place.map { " · \($0)" } ?? "")")
            .font(.system(size: 12)).lineLimit(1)
        } else {
          Text("No more classes").font(.system(size: 13))
        }
        if let deadline {
          Text("Due \(deadline.title)").font(.system(size: 12)).foregroundStyle(.secondary)
            .lineLimit(1)
        }
      }
    default:
      VStack(alignment: .leading, spacing: 4) {
        Eyebrow(text: "Next class")
        if let next {
          Text(next.title).font(.system(size: 15, weight: .semibold)).lineLimit(2)
          Text("\(clockText(next.startDate))–\(clockText(next.endDate))")
            .font(.figure(13, weight: .medium)).foregroundStyle(.secondary)
          if let place = next.place {
            Text(place).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
          }
        } else {
          Text("—").font(.figure(22)).foregroundStyle(.tertiary)
        }
        Spacer(minLength: 0)
        if let deadline {
          Eyebrow(text: "Due")
          Text(deadline.title).font(.system(size: 12)).lineLimit(1)
            .foregroundStyle(deadline.overdue ? .red : .primary)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

// MARK: - Budget

struct BudgetWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "DashboardBudget", provider: TodayProvider()) { entry in
      BudgetView(entry: entry)
        .foregroundStyle(Color.themeLabel)
        .containerBackground(Color.themeBackground, for: .widget)
        .widgetURL(URL(string: "dashboard://money?view=budget"))
    }
    .configurationDisplayName("Budget")
    .description("What is left this month.")
    .supportedFamilies([.systemSmall, .accessoryRectangular, .accessoryCircular])
  }
}

struct BudgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: TodayEntry

  var body: some View {
    if let budget = entry.snapshot.payload.budget {
      let fraction =
        budget.plannedMinor > 0
        ? min(1, max(0, Double(budget.spentMinor) / Double(budget.plannedMinor))) : 0
      let tone: Color = budget.availableMinor < 0 ? .red : .primary
      switch family {
      case .accessoryCircular:
        Gauge(value: fraction) {
          Text("Spent")
        } currentValueLabel: {
          Text("\(Int(fraction * 100))")
        }
        .gaugeStyle(.accessoryCircularCapacity)
      case .accessoryRectangular:
        VStack(alignment: .leading, spacing: 1) {
          Text("Left this month").font(.system(size: 12, weight: .semibold)).widgetAccentable()
          money(budget.availableMinor, budget.currency).font(.figure(20))
          ProgressView(value: fraction).tint(.primary)
        }
      default:
        VStack(alignment: .leading, spacing: 4) {
          Eyebrow(text: "Left")
          Spacer(minLength: 0)
          money(budget.availableMinor, budget.currency)
            .font(.figure(28)).foregroundStyle(tone)
            .lineLimit(1).minimumScaleFactor(0.5)
          HStack(spacing: 0) {
            money(budget.spentMinor, budget.currency)
            Text(" of ")
            money(budget.plannedMinor, budget.currency)
          }
          .font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
          Capsule().fill(.quaternary).frame(height: 3)
            .overlay(alignment: .leading) {
              GeometryReader { proxy in
                Capsule().fill(tone).frame(width: proxy.size.width * fraction, height: 3)
              }
            }
          if entry.snapshot.payload.counts.budgetAlerts > 0 {
            Text("\(entry.snapshot.payload.counts.budgetAlerts) alerts")
              .font(.system(size: 11)).foregroundStyle(.orange)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    } else if !entry.snapshot.signedIn {
      SignedOutView()
    } else {
      Text("—").font(.figure(22)).foregroundStyle(.tertiary)
    }
  }
}

// MARK: - Watchlist

struct WatchlistEntry: TimelineEntry {
  let date: Date
  let quotes: [WatchlistQuote]
  let at: Date?
}

/// Reads what the app stored after its own batched quote call. Never fetches:
/// the provider budget is 50 requests an hour for everything.
struct WatchlistProvider: TimelineProvider {
  func placeholder(in context: Context) -> WatchlistEntry {
    WatchlistEntry(
      date: Date(),
      quotes: [
        .init(symbol: "AAPL", price: 231.4, changePercent: 0.8, currency: "USD"),
        .init(symbol: "MSFT", price: 418.2, changePercent: -0.4, currency: "USD"),
      ], at: Date())
  }

  func getSnapshot(in context: Context, completion: @escaping (WatchlistEntry) -> Void) {
    completion(context.isPreview ? placeholder(in: context) : current())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<WatchlistEntry>) -> Void) {
    completion(Timeline(entries: [current()], policy: .never))
  }

  private func current() -> WatchlistEntry {
    let stored = WatchlistStore.stored()
    return WatchlistEntry(date: Date(), quotes: stored?.quotes ?? [], at: stored?.at)
  }
}

struct WatchlistWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "DashboardWatchlist", provider: WatchlistProvider()) { entry in
      WatchlistView(entry: entry)
        .foregroundStyle(Color.themeLabel)
        .containerBackground(Color.themeBackground, for: .widget)
        .widgetURL(URL(string: "dashboard://money?view=markets"))
    }
    .configurationDisplayName("Watchlist")
    .description("Quotes as of the app's last refresh.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

struct WatchlistView: View {
  @Environment(\.widgetFamily) private var family
  let entry: WatchlistEntry

  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      HStack {
        Eyebrow(text: "Watchlist")
        Spacer()
        if let at = entry.at {
          Text(at, style: .relative).font(.system(size: 10)).foregroundStyle(.tertiary)
        }
      }
      if entry.quotes.isEmpty {
        Text("—").font(.figure(22)).foregroundStyle(.tertiary)
      }
      ForEach(entry.quotes.prefix(family == .systemMedium ? 5 : 4)) { quote in
        HStack {
          Text(quote.symbol).font(.system(size: 13, weight: .semibold))
          Spacer()
          if let price = quote.price {
            Text(price, format: .number.precision(.fractionLength(2)))
              .font(.figure(13, weight: .medium))
          }
          if family == .systemMedium, let change = quote.changePercent {
            Text(String(format: "%+.2f%%", change))
              .font(.figure(12, weight: .medium))
              .foregroundStyle(change >= 0 ? .green : .red)
              .frame(width: 60, alignment: .trailing)
          }
        }
      }
      Spacer(minLength: 0)
    }
  }
}
