import ExpoModulesCore
import HealthKit

struct NutritionDay: Record {
  @Field var date: String = ""
  @Field var calories: Double = 0
  @Field var protein: Double = 0
  @Field var carbs: Double = 0
  @Field var fat: Double = 0
}

enum MacrosHealthError: Error {
  case invalidDate(String)
  case invalidTimeZone(String)
}

private let bodyMass = HKQuantityType(.bodyMass)
private let bodyFat = HKQuantityType(.bodyFatPercentage)
private let steps = HKQuantityType(.stepCount)
private let activeEnergy = HKQuantityType(.activeEnergyBurned)
private let dietaryEnergy = HKQuantityType(.dietaryEnergyConsumed)
private let dietaryProtein = HKQuantityType(.dietaryProtein)
private let dietaryCarbs = HKQuantityType(.dietaryCarbohydrates)
private let dietaryFat = HKQuantityType(.dietaryFatTotal)

private let readTypes: Set<HKObjectType> = [bodyMass, bodyFat, steps, activeEnergy]
private let writeTypes: Set<HKSampleType> = [
  dietaryEnergy, dietaryProtein, dietaryCarbs, dietaryFat,
]

/// Days are the profile's calendar days, named "yyyy-MM-dd" in its time zone,
/// the same keys the server files weigh-ins and activity under.
private struct DayCalendar {
  let calendar: Calendar
  let formatter: DateFormatter

  init(timeZone identifier: String) throws {
    guard let zone = TimeZone(identifier: identifier) else {
      throw MacrosHealthError.invalidTimeZone(identifier)
    }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = zone
    self.calendar = calendar
    let formatter = DateFormatter()
    formatter.calendar = calendar
    formatter.timeZone = zone
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    self.formatter = formatter
  }

  func start(of day: String) throws -> Date {
    guard let date = formatter.date(from: day) else {
      throw MacrosHealthError.invalidDate(day)
    }
    return calendar.startOfDay(for: date)
  }

  func end(of day: String) throws -> Date {
    let start = try start(of: day)
    return calendar.date(byAdding: .day, value: 1, to: start) ?? start
  }

  func key(for date: Date) -> String {
    formatter.string(from: date)
  }
}

public class MacrosHealthModule: Module {
  private let store = HKHealthStore()

  public func definition() -> ModuleDefinition {
    Name("MacrosHealth")

    Function("isAvailable") {
      HKHealthStore.isHealthDataAvailable()
    }

    // HealthKit never says whether read access was granted, only that the
    // prompt was answered, so this resolves true once the sheet is dismissed.
    AsyncFunction("requestAuthorization") { () async throws -> Bool in
      try await self.store.requestAuthorization(toShare: writeTypes, read: readTypes)
      return true
    }

    AsyncFunction("readDailyActivity") {
      (start: String, end: String, timeZone: String) async throws -> [[String: Any]] in
      let days = try DayCalendar(timeZone: timeZone)
      let from = try days.start(of: start)
      let to = try days.end(of: end)
      async let stepTotals = self.dailySums(of: steps, unit: .count(), from: from, to: to, days: days)
      async let energyTotals = self.dailySums(
        of: activeEnergy, unit: .kilocalorie(), from: from, to: to, days: days)
      let (stepsByDay, energyByDay) = try await (stepTotals, energyTotals)
      let keys = Set(stepsByDay.keys).union(energyByDay.keys).sorted()
      return keys.map { key in
        var row: [String: Any] = ["date": key]
        if let value = stepsByDay[key] { row["steps"] = Int(value.rounded()) }
        if let value = energyByDay[key] { row["activeEnergyKcal"] = value }
        return row
      }
    }

    // The first weigh-in of each day: the morning reading a trend should use.
    AsyncFunction("readBodySamples") {
      (start: String, end: String, timeZone: String) async throws -> [[String: Any]] in
      let days = try DayCalendar(timeZone: timeZone)
      let from = try days.start(of: start)
      let to = try days.end(of: end)
      let weights = try await self.firstPerDay(
        of: bodyMass, unit: .gramUnit(with: .kilo), from: from, to: to, days: days)
      let fats = try await self.firstPerDay(
        of: bodyFat, unit: .percent(), from: from, to: to, days: days)
      return weights.keys.sorted().compactMap { key in
        guard let weight = weights[key] else { return nil }
        var row: [String: Any] = ["date": key, "weightKg": weight]
        if let fraction = fats[key] { row["bodyFatPct"] = fraction * 100 }
        return row
      }
    }

    // One sample per nutrient per day, keyed by a sync identifier: saving a
    // higher version replaces the day's previous sample, so edits, deletes and
    // replayed offline logs all converge on the server's totals.
    AsyncFunction("writeDailyNutrition") {
      (entries: [NutritionDay], timeZone: String) async throws -> Int in
      let days = try DayCalendar(timeZone: timeZone)
      let now = Date()
      let version = Int(now.timeIntervalSince1970 * 1000)
      let writable = writeTypes.filter {
        self.store.authorizationStatus(for: $0) == .sharingAuthorized
      }
      var samples: [HKQuantitySample] = []
      for entry in entries {
        let start = try days.start(of: entry.date)
        guard start < now else { continue }
        let end = min(try days.end(of: entry.date), now)
        let values: [(HKQuantityType, HKQuantity, String)] = [
          (dietaryEnergy, HKQuantity(unit: .kilocalorie(), doubleValue: entry.calories), "energy"),
          (dietaryProtein, HKQuantity(unit: .gram(), doubleValue: entry.protein), "protein"),
          (dietaryCarbs, HKQuantity(unit: .gram(), doubleValue: entry.carbs), "carbs"),
          (dietaryFat, HKQuantity(unit: .gram(), doubleValue: entry.fat), "fat"),
        ]
        for (type, quantity, name) in values where writable.contains(type) {
          samples.append(
            HKQuantitySample(
              type: type, quantity: quantity, start: start, end: end,
              metadata: [
                HKMetadataKeySyncIdentifier: "macros.\(entry.date).\(name)",
                HKMetadataKeySyncVersion: version,
              ]))
        }
      }
      if samples.isEmpty { return 0 }
      try await self.store.save(samples)
      return samples.count
    }
  }

  private func dailySums(
    of type: HKQuantityType, unit: HKUnit, from: Date, to: Date, days: DayCalendar
  ) async throws -> [String: Double] {
    let predicate = HKQuery.predicateForSamples(withStart: from, end: to)
    let descriptor = HKStatisticsCollectionQueryDescriptor(
      predicate: HKSamplePredicate.quantitySample(type: type, predicate: predicate),
      options: .cumulativeSum,
      anchorDate: from,
      intervalComponents: DateComponents(day: 1))
    let collection = try await descriptor.result(for: store)
    var totals: [String: Double] = [:]
    collection.enumerateStatistics(from: from, to: to) { statistics, _ in
      if let sum = statistics.sumQuantity() {
        totals[days.key(for: statistics.startDate)] = sum.doubleValue(for: unit)
      }
    }
    return totals
  }

  private func firstPerDay(
    of type: HKQuantityType, unit: HKUnit, from: Date, to: Date, days: DayCalendar
  ) async throws -> [String: Double] {
    let predicate = HKQuery.predicateForSamples(withStart: from, end: to)
    let descriptor = HKSampleQueryDescriptor(
      predicates: [.quantitySample(type: type, predicate: predicate)],
      sortDescriptors: [SortDescriptor(\.startDate, order: .forward)])
    let samples = try await descriptor.result(for: store)
    var values: [String: Double] = [:]
    for sample in samples {
      let key = days.key(for: sample.startDate)
      if values[key] == nil {
        values[key] = sample.quantity.doubleValue(for: unit)
      }
    }
    return values
  }
}
