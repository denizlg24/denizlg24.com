import AppKit
import Darwin
import Foundation

private enum Profile: String, CaseIterable {
  case all
  case pi
  case forge

  var label: String {
    switch self {
    case .all: "Pi + Forge"
    case .pi: "Pi"
    case .forge: "Forge"
    }
  }

  var hosts: Set<Profile> {
    self == .all ? [.pi, .forge] : [self]
  }
}

private struct Options {
  let command: URL
  let config: URL
  let logRoot: URL
  let state: URL
  let source: String
  let interval: TimeInterval
  let scheduleEnabled: Bool

  init(arguments: [String]) throws {
    var values: [String: String] = [:]
    var index = 0
    while index < arguments.count {
      let key = arguments[index]
      guard key.hasPrefix("--"), index + 1 < arguments.count else {
        throw MenuBarError.usage
      }
      values[key] = arguments[index + 1]
      index += 2
    }
    guard let command = values["--command"], command.hasPrefix("/"),
      let config = values["--config"], config.hasPrefix("/"),
      let logRoot = values["--log-root"], logRoot.hasPrefix("/"),
      let state = values["--state"], state.hasPrefix("/"),
      let source = values["--source"], ["r2", "ssh"].contains(source),
      let intervalText = values["--interval"],
      let interval = TimeInterval(intervalText), 300...604_800 ~= interval,
      let enabledText = values["--schedule-enabled"],
      let scheduleEnabled = Bool(enabledText)
    else {
      throw MenuBarError.usage
    }
    self.command = URL(fileURLWithPath: command)
    self.config = URL(fileURLWithPath: config)
    self.logRoot = URL(fileURLWithPath: logRoot, isDirectory: true)
    self.state = URL(fileURLWithPath: state)
    self.source = source
    self.interval = interval
    self.scheduleEnabled = scheduleEnabled
  }
}

private enum MenuBarError: LocalizedError {
  case usage
  case commandUnavailable
  case responsibilityUnavailable

  var errorDescription: String? {
    switch self {
    case .usage:
      "usage: dr-menubar --command PATH --config PATH --source ssh|r2 --interval SECONDS --schedule-enabled true|false --log-root PATH --state PATH"
    case .commandUnavailable:
      "The installed DR command is unavailable. Re-run the Mac DR installer."
    case .responsibilityUnavailable:
      "macOS would not let the copy run under its own privacy identity, so iCloud Drive would refuse it."
    }
  }
}

private typealias DisclaimResponsibility =
  @convention(c) (UnsafeMutablePointer<posix_spawnattr_t?>, Int32) -> Int32

private let disclaimResponsibility: DisclaimResponsibility? = {
  // RTLD_DEFAULT from dlfcn.h, which Swift cannot import as a macro.
  let searchEverywhere = UnsafeMutableRawPointer(bitPattern: -2)
  guard let symbol = dlsym(searchEverywhere, "responsibility_spawnattrs_setdisclaim") else {
    return nil
  }
  return unsafeBitCast(symbol, to: DisclaimResponsibility.self)
}()

/// Copies have to answer macOS privacy checks as themselves. Spawned as plain
/// children, their iCloud Drive access is judged against this menu bar app,
/// which holds no grant and could not keep one: every install re-signs it ad
/// hoc. Downloads keep the app's identity, since the folder the user picked in
/// its open panel was consented to by the app.
private func spawn(
  _ executable: URL, arguments: [String], output: FileHandle, disclaimingResponsibility: Bool
) throws -> pid_t {
  var actions: posix_spawn_file_actions_t?
  posix_spawn_file_actions_init(&actions)
  defer { posix_spawn_file_actions_destroy(&actions) }
  posix_spawn_file_actions_addopen(&actions, STDIN_FILENO, "/dev/null", O_RDONLY, 0)
  posix_spawn_file_actions_adddup2(&actions, output.fileDescriptor, STDOUT_FILENO)
  posix_spawn_file_actions_adddup2(&actions, output.fileDescriptor, STDERR_FILENO)

  var attributes: posix_spawnattr_t?
  posix_spawnattr_init(&attributes)
  defer { posix_spawnattr_destroy(&attributes) }
  var defaultSignals = sigset_t()
  sigfillset(&defaultSignals)
  var unblockedSignals = sigset_t()
  sigemptyset(&unblockedSignals)
  posix_spawnattr_setsigdefault(&attributes, &defaultSignals)
  posix_spawnattr_setsigmask(&attributes, &unblockedSignals)
  posix_spawnattr_setflags(
    &attributes,
    Int16(POSIX_SPAWN_SETSIGDEF | POSIX_SPAWN_SETSIGMASK | POSIX_SPAWN_CLOEXEC_DEFAULT))
  if disclaimingResponsibility {
    guard let disclaimResponsibility, disclaimResponsibility(&attributes, 1) == 0 else {
      throw MenuBarError.responsibilityUnavailable
    }
  }

  let argv = ([executable.path] + arguments).map { strdup($0) }
  defer { for argument in argv { free(argument) } }
  var pid: pid_t = 0
  let result = posix_spawn(&pid, executable.path, &actions, &attributes, argv + [nil], environ)
  guard result == 0 else {
    throw POSIXError(POSIXErrorCode(rawValue: result) ?? .EIO)
  }
  return pid
}

private func waitForExit(_ pid: pid_t) -> Int32 {
  var status: Int32 = 0
  while waitpid(pid, &status, 0) == -1 {
    guard errno == EINTR else { return -1 }
  }
  let signal = status & 0x7f
  return signal == 0 ? (status >> 8) & 0xff : 128 + signal
}

private final class RunningJob {
  let id = UUID()
  let title: String
  let profile: Profile
  let command: String
  let startedAt = Date()
  let log: FileHandle
  let logURL: URL

  init(title: String, profile: Profile, command: String, log: FileHandle, logURL: URL) {
    self.title = title
    self.profile = profile
    self.command = command
    self.log = log
    self.logURL = logURL
  }
}

private final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
  private let options: Options
  private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
  private let menu = NSMenu()
  private let iso = ISO8601DateFormatter()
  private var activeJobs: [UUID: RunningJob] = [:]
  private var hostStates: [String: [String: Any]] = [:]
  private var report: [String: Any] = [:]
  private var nextRunAt: Date?
  private var scheduleTimer: Timer?
  private var signalSource: DispatchSourceSignal?
  private var refreshing = false
  private var lastTask: (title: String, succeeded: Bool, completedAt: Date, log: URL)?

  init(options: Options) {
    self.options = options
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    super.init()
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.accessory)
    menu.delegate = self
    statusItem.menu = menu
    statusItem.button?.toolTip = "DR Backups"
    installSignalHandler()
    loadState()
    updateStatusIcon()
    refreshStatus()
    scheduleNextCycle()
  }

  func menuNeedsUpdate(_ menu: NSMenu) {
    refreshStatus()
    rebuildMenu()
  }

  private func installSignalHandler() {
    let source = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
    source.setEventHandler { [weak self] in
      self?.startCycle(profile: .all, scheduled: false)
    }
    source.resume()
    signalSource = source
  }

  private func loadState() {
    guard let data = try? Data(contentsOf: options.state),
      let state = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return }
    report = state["report"] as? [String: Any] ?? [:]
    if report["status"] as? String == "running" {
      let completed = iso.string(from: Date())
      report["status"] = "failed"
      report["completedAt"] = completed
      report["detail"] =
        "The menu bar process restarted before the previous copy reported completion. Check its task log and run the copy again."
      report["verification"] = NSNull()
    }
    if let next = state["nextRunAt"] as? String {
      nextRunAt = iso.date(from: next)
    }
  }

  private func writeState() {
    let jobs = activeJobs.values
      .sorted { $0.startedAt < $1.startedAt }
      .map { job in
        [
          "id": job.id.uuidString,
          "title": job.title,
          "command": job.command,
          "profile": job.profile.rawValue,
          "startedAt": iso.string(from: job.startedAt),
          "log": job.logURL.path,
        ]
      }
    let state: [String: Any] = [
      "schemaVersion": 1,
      "source": options.source,
      "intervalSeconds": Int(options.interval),
      "scheduleEnabled": options.scheduleEnabled,
      "nextRunAt": nextRunAt.map(iso.string(from:)) ?? NSNull(),
      "activeJobs": jobs,
      "report": report,
    ]
    guard JSONSerialization.isValidJSONObject(state),
      let data = try? JSONSerialization.data(
        withJSONObject: state, options: [.prettyPrinted, .sortedKeys])
    else { return }
    do {
      try FileManager.default.createDirectory(
        at: options.state.deletingLastPathComponent(),
        withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o700]
      )
      try data.write(to: options.state, options: .atomic)
      try FileManager.default.setAttributes(
        [.posixPermissions: 0o600], ofItemAtPath: options.state.path)
    } catch {
      fputs("dr-menubar: unable to save state: \(error.localizedDescription)\n", stderr)
    }
  }

  private func scheduleNextCycle() {
    scheduleTimer?.invalidate()
    guard options.scheduleEnabled else {
      nextRunAt = nil
      writeState()
      return
    }
    let now = Date()
    if nextRunAt == nil || nextRunAt! <= now {
      nextRunAt = now.addingTimeInterval(1)
    }
    let delay = max(0.25, nextRunAt!.timeIntervalSince(now))
    scheduleTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
      guard let self else { return }
      self.nextRunAt = Date().addingTimeInterval(self.options.interval)
      self.startCycle(profile: .all, scheduled: true)
      self.scheduleNextCycle()
    }
    writeState()
  }

  private func cycleIsRunning(for profile: Profile) -> Bool {
    activeJobs.values.contains { job in
      job.command == "cycle" && !job.profile.hosts.isDisjoint(with: profile.hosts)
    }
  }

  private func startCycle(profile: Profile, scheduled: Bool) {
    guard !cycleIsRunning(for: profile) else {
      if !scheduled { NSSound.beep() }
      return
    }
    var arguments = ["--config", options.config.path, "cycle"]
    if options.source == "r2" {
      arguments += ["--profile", profile.rawValue]
    } else if profile != .all {
      return
    }
    let prefix = scheduled ? "Scheduled copy" : "Copy"
    startProcess(
      title: "\(prefix): \(profile.label)",
      profile: profile,
      command: "cycle",
      arguments: arguments,
      contributesReport: profile == .all
    )
  }

  @objc private func runCopy(_ sender: NSMenuItem) {
    guard let raw = sender.representedObject as? String,
      let profile = Profile(rawValue: raw)
    else { return }
    startCycle(profile: profile, scheduled: false)
  }

  @objc private func download(_ sender: NSMenuItem) {
    guard options.source == "r2",
      let raw = sender.representedObject as? String,
      let profile = Profile(rawValue: raw)
    else { return }
    let panel = NSOpenPanel()
    panel.title = "Choose where to keep the encrypted backup"
    panel.message =
      "A verified \(profile.label) backup will be downloaded inside the selected folder."
    panel.prompt = "Download"
    panel.canChooseFiles = false
    panel.canChooseDirectories = true
    panel.canCreateDirectories = true
    panel.allowsMultipleSelection = false
    NSApp.activate(ignoringOtherApps: true)
    guard panel.runModal() == .OK, let destination = panel.url else { return }
    startProcess(
      title: "Download: \(profile.label)",
      profile: profile,
      command: "download",
      arguments: [
        "--config", options.config.path,
        "download", "--profile", profile.rawValue,
        "--destination", destination.path,
      ],
      contributesReport: false
    )
  }

  private func startProcess(
    title: String,
    profile: Profile,
    command: String,
    arguments: [String],
    contributesReport: Bool
  ) {
    guard FileManager.default.isExecutableFile(atPath: options.command.path) else {
      recordLaunchFailure(
        title: title,
        error: MenuBarError.commandUnavailable,
        contributesReport: contributesReport
      )
      return
    }
    do {
      try FileManager.default.createDirectory(
        at: options.logRoot,
        withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o700]
      )
      let stamp = iso.string(from: Date())
        .replacingOccurrences(of: ":", with: "-")
      let logURL = options.logRoot.appendingPathComponent(
        "\(command)-\(profile.rawValue)-\(stamp).log")
      FileManager.default.createFile(
        atPath: logURL.path, contents: nil, attributes: [.posixPermissions: 0o600])
      let handle = try FileHandle(forWritingTo: logURL)
      let pid: pid_t
      do {
        pid = try spawn(
          options.command, arguments: arguments, output: handle,
          disclaimingResponsibility: command == "cycle")
      } catch {
        try? handle.close()
        throw error
      }
      let job = RunningJob(
        title: title, profile: profile, command: command, log: handle, logURL: logURL)
      DispatchQueue.global(qos: .utility).async { [weak self] in
        let status = waitForExit(pid)
        DispatchQueue.main.async {
          self?.finish(job: job, status: status, contributesReport: contributesReport)
        }
      }
      activeJobs[job.id] = job
      if contributesReport {
        let lastSuccess = report["lastSuccessAt"] ?? NSNull()
        report = [
          "job": "icloud",
          "runId": iso.string(from: job.startedAt),
          "status": "running",
          "startedAt": iso.string(from: job.startedAt),
          "completedAt": NSNull(),
          "lastSuccessAt": lastSuccess,
          "nextRunAt": nextRunAt.map(iso.string(from:)) ?? NSNull(),
          "durationMs": NSNull(),
          "sizeBytes": NSNull(),
          "enabled": options.scheduleEnabled,
          "schedule": String(Int(options.interval)),
          "detail": "Copying and verifying the independent iCloud backup.",
          "verification": NSNull(),
        ]
      }
      writeState()
      updateStatusIcon()
      rebuildMenu()
    } catch {
      recordLaunchFailure(title: title, error: error, contributesReport: contributesReport)
    }
  }

  private func finish(job: RunningJob, status: Int32, contributesReport: Bool) {
    try? job.log.close()
    activeJobs.removeValue(forKey: job.id)
    let completedAt = Date()
    let succeeded = status == 0
    lastTask = (job.title, succeeded, completedAt, job.logURL)
    if contributesReport {
      let completed = iso.string(from: completedAt)
      let lastSuccess = succeeded ? completed : report["lastSuccessAt"] ?? NSNull()
      report["status"] = succeeded ? "completed" : "failed"
      report["completedAt"] = completed
      report["lastSuccessAt"] = lastSuccess
      report["nextRunAt"] = nextRunAt.map(iso.string(from:)) ?? NSNull()
      report["durationMs"] = max(0, Int(completedAt.timeIntervalSince(job.startedAt) * 1_000))
      report["detail"] =
        "\(job.title) exited with code \(status). Full output is retained on the Mac."
      report["verification"] =
        succeeded
        ? "The iCloud cycle completed its source checks, signature validation, and confirmed upload steps."
        : NSNull()
    }
    writeState()
    refreshStatus()
    updateStatusIcon()
    rebuildMenu()
  }

  private func recordLaunchFailure(title: String, error: Error, contributesReport: Bool) {
    let completedAt = Date()
    lastTask = (title, false, completedAt, options.logRoot)
    if contributesReport {
      let completed = iso.string(from: completedAt)
      report = [
        "job": "icloud",
        "runId": completed,
        "status": "failed",
        "startedAt": completed,
        "completedAt": completed,
        "lastSuccessAt": report["lastSuccessAt"] ?? NSNull(),
        "nextRunAt": nextRunAt.map(iso.string(from:)) ?? NSNull(),
        "durationMs": 0,
        "sizeBytes": NSNull(),
        "enabled": options.scheduleEnabled,
        "schedule": String(Int(options.interval)),
        "detail": "The menu bar app could not start the copy: \(error.localizedDescription)",
        "verification": NSNull(),
      ]
    }
    fputs("dr-menubar: \(error.localizedDescription)\n", stderr)
    writeState()
    updateStatusIcon()
    rebuildMenu()
  }

  private func refreshStatus() {
    guard !refreshing, FileManager.default.isExecutableFile(atPath: options.command.path) else {
      return
    }
    refreshing = true
    let process = Process()
    let output = Pipe()
    process.executableURL = options.command
    process.arguments = ["--config", options.config.path, "status"]
    process.environment = ProcessInfo.processInfo.environment
    process.standardOutput = output
    process.standardError = FileHandle.nullDevice
    process.terminationHandler = { [weak self] process in
      let data = output.fileHandleForReading.readDataToEndOfFile()
      DispatchQueue.main.async {
        guard let self else { return }
        self.refreshing = false
        if process.terminationStatus == 0 {
          self.consumeStatus(data)
        }
        self.rebuildMenu()
      }
    }
    do {
      try process.run()
    } catch {
      refreshing = false
    }
  }

  private func consumeStatus(_ data: Data) {
    guard let text = String(data: data, encoding: .utf8) else { return }
    var states: [String: [String: Any]] = [:]
    for line in text.split(whereSeparator: \.isNewline) {
      guard let payload = line.data(using: .utf8),
        let object = try? JSONSerialization.jsonObject(with: payload) as? [String: Any]
      else { continue }
      if let host = object["host"] as? String {
        states[host] = object
      } else if let hosts = object["hosts"] as? [[String: Any]] {
        for hostState in hosts {
          if let host = hostState["host"] as? String { states[host] = hostState }
        }
      }
    }
    if !states.isEmpty { hostStates = states }
  }

  private func updateStatusIcon() {
    let failed = lastTask?.succeeded == false || report["status"] as? String == "failed"
    let symbol: String
    let description: String
    if !activeJobs.isEmpty {
      symbol = "arrow.triangle.2.circlepath.icloud"
      description = "DR backup running"
    } else if failed {
      symbol = "exclamationmark.icloud"
      description = "DR backup needs attention"
    } else {
      symbol = "externaldrive.badge.icloud"
      description = "DR backups"
    }
    let configuration = NSImage.SymbolConfiguration(pointSize: 13, weight: .semibold)
    let image = NSImage(systemSymbolName: symbol, accessibilityDescription: description)?
      .withSymbolConfiguration(configuration)
    image?.isTemplate = true
    statusItem.button?.image = image
    statusItem.button?.title = image == nil ? "DR" : ""
    statusItem.button?.toolTip = description
  }

  private func rebuildMenu() {
    guard statusItem.menu === menu else { return }
    menu.removeAllItems()
    let heading = NSMenuItem(title: "DR Backups", action: nil, keyEquivalent: "")
    heading.isEnabled = false
    menu.addItem(heading)

    if activeJobs.isEmpty {
      addInfo("Idle")
    } else {
      for job in activeJobs.values.sorted(by: { $0.startedAt < $1.startedAt }) {
        addInfo("Running · \(job.title)")
      }
    }
    addHostState(host: "pi-cloud", label: "Pi")
    addHostState(host: "forge", label: "Forge")
    if options.scheduleEnabled, let nextRunAt {
      addInfo("Next copy \(nextRunAt.formatted(date: .abbreviated, time: .shortened))")
    } else {
      addInfo("Automatic copies paused")
    }
    if let lastTask {
      addInfo("\(lastTask.succeeded ? "Completed" : "Failed") · \(lastTask.title)")
    }

    menu.addItem(.separator())
    addAction(
      "Copy Pi + Forge Now", selector: #selector(runCopy(_:)), profile: .all,
      enabled: !cycleIsRunning(for: .all))
    if options.source == "r2" {
      addAction(
        "Copy Pi Now", selector: #selector(runCopy(_:)), profile: .pi,
        enabled: !cycleIsRunning(for: .pi))
      addAction(
        "Copy Forge Now", selector: #selector(runCopy(_:)), profile: .forge,
        enabled: !cycleIsRunning(for: .forge))
    }

    if options.source == "r2" {
      menu.addItem(.separator())
      let downloads = NSMenu()
      for profile in Profile.allCases {
        let item = NSMenuItem(
          title: profile == .all ? "Latest Pi + Forge Pair…" : "Latest \(profile.label) Copy…",
          action: #selector(download(_:)),
          keyEquivalent: ""
        )
        item.target = self
        item.representedObject = profile.rawValue
        downloads.addItem(item)
      }
      let parent = NSMenuItem(title: "Download Encrypted Backup", action: nil, keyEquivalent: "")
      parent.submenu = downloads
      menu.addItem(parent)
    }

    menu.addItem(.separator())
    let refresh = NSMenuItem(
      title: refreshing ? "Refreshing…" : "Refresh Status", action: #selector(refresh(_:)),
      keyEquivalent: "r")
    refresh.target = self
    refresh.isEnabled = !refreshing
    menu.addItem(refresh)
    let logs = NSMenuItem(title: "Open Logs", action: #selector(openLogs(_:)), keyEquivalent: "")
    logs.target = self
    menu.addItem(logs)
    if let lastTask, lastTask.log != options.logRoot {
      let lastLog = NSMenuItem(
        title: "Open Last Task Log", action: #selector(openLastLog(_:)), keyEquivalent: "")
      lastLog.target = self
      menu.addItem(lastLog)
    }
    menu.addItem(.separator())
    let quit = NSMenuItem(title: "Quit DR Backups", action: #selector(quit(_:)), keyEquivalent: "q")
    quit.target = self
    quit.isEnabled = activeJobs.isEmpty
    menu.addItem(quit)
  }

  private func addInfo(_ title: String) {
    let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    item.isEnabled = false
    menu.addItem(item)
  }

  private func addHostState(host: String, label: String) {
    guard let state = hostStates[host] else {
      addInfo("\(label) · waiting for status")
      return
    }
    let phase = (state["phase"] as? String ?? "unknown").replacingOccurrences(of: "-", with: " ")
    if let confirmed = state["confirmedObjects"] as? Int,
      let total = state["totalObjects"] as? Int, total > 0
    {
      addInfo("\(label) · \(phase) \(confirmed)/\(total)")
    } else {
      addInfo("\(label) · \(phase)")
    }
  }

  private func addAction(_ title: String, selector: Selector, profile: Profile, enabled: Bool) {
    let item = NSMenuItem(title: title, action: selector, keyEquivalent: "")
    item.target = self
    item.representedObject = profile.rawValue
    item.isEnabled = enabled
    menu.addItem(item)
  }

  @objc private func refresh(_ sender: NSMenuItem) {
    refreshStatus()
  }

  @objc private func openLogs(_ sender: NSMenuItem) {
    try? FileManager.default.createDirectory(at: options.logRoot, withIntermediateDirectories: true)
    NSWorkspace.shared.open(options.logRoot)
  }

  @objc private func openLastLog(_ sender: NSMenuItem) {
    guard let lastTask else { return }
    NSWorkspace.shared.activateFileViewerSelecting([lastTask.log])
  }

  @objc private func quit(_ sender: NSMenuItem) {
    NSApp.terminate(nil)
  }
}

umask(0o077)
// SIGUSR1's default action terminates the process, and the dispatch source that
// handles it is only installed once AppKit has finished launching.
signal(SIGUSR1, SIG_IGN)
do {
  let options = try Options(arguments: Array(CommandLine.arguments.dropFirst()))
  let app = NSApplication.shared
  let delegate = AppDelegate(options: options)
  app.delegate = delegate
  app.run()
} catch {
  fputs("dr-menubar: \(error.localizedDescription)\n", stderr)
  exit(2)
}
