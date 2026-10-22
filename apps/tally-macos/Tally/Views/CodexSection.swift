import SwiftUI

struct CodexSection: View {
    let monitor: CodexMonitor

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader("Codex") {
                if let usage = monitor.usage {
                    HStack(spacing: 8) {
                        if let plan = usage.plan { Text(plan) }
                        Text(usage.source == .live ? "live" : "session log")
                        Text(Format.ago(usage.fetchedAt))
                    }
                }
            }
            if monitor.usage?.limitReached == true {
                Text("Limit reached")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.red)
            }
            WindowReadout(label: "5h", window: monitor.usage?.session)
            WindowReadout(label: "7d", window: monitor.usage?.week)
            IssueText(text: monitor.usage == nil ? monitor.issue : nil)
        }
    }
}
