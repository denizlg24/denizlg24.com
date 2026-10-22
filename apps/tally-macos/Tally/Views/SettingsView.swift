import ServiceManagement
import SwiftUI

struct SettingsView: View {
    let model: AppModel
    @AppStorage("refreshInterval") private var refreshInterval: Double = 180
    @AppStorage("alertThreshold") private var alertThreshold: Double = 90
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
    @State private var loginItemIssue: String?

    var body: some View {
        Form {
            Section {
                Toggle("Open at login", isOn: $launchAtLogin)
                    .onChange(of: launchAtLogin) { _, enabled in setLaunchAtLogin(enabled) }
                IssueText(text: loginItemIssue)
                Picker("Refresh usage", selection: $refreshInterval) {
                    Text("1 min").tag(60.0)
                    Text("3 min").tag(180.0)
                    Text("5 min").tag(300.0)
                    Text("10 min").tag(600.0)
                }
                Picker("Notify at", selection: $alertThreshold) {
                    Text("75%").tag(75.0)
                    Text("85%").tag(85.0)
                    Text("90%").tag(90.0)
                    Text("95%").tag(95.0)
                }
            }
            Section("denizlg24") {
                LabeledContent("Account") {
                    switch model.site.status {
                    case .signedIn:
                        Button("Sign Out") { Task { await model.site.signOut() } }
                    case .signingIn:
                        ProgressView().controlSize(.small)
                    case .signedOut:
                        Button("Sign In") { Task { await model.site.signIn() } }
                    }
                }
            }
            Section("Claude seats") {
                ForEach(model.claude.seats) { seat in
                    LabeledContent(seat.title, value: seat.email)
                }
                Button("Add Seat") { Task { await model.claude.addSeat() } }
            }
            Section {
                LabeledContent("Version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev")
                Button("Show Data Folder") { NSWorkspace.shared.open(Storage.directory) }
            }
        }
        .formStyle(.grouped)
        .frame(width: 440)
        .fixedSize(horizontal: false, vertical: true)
    }

    private func setLaunchAtLogin(_ enabled: Bool) {
        do {
            if enabled {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
            loginItemIssue = nil
        } catch {
            loginItemIssue = error.localizedDescription
            launchAtLogin = SMAppService.mainApp.status == .enabled
        }
    }
}
