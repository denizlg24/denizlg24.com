import SwiftUI

struct ClaudeSection: View {
    let model: AppModel
    @State private var renaming: ClaudeSeat?
    @State private var nickname = ""

    private var seats: ClaudeSeats { model.claude }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader("Claude") {
                HStack(spacing: 12) {
                    if let event = seats.lastEvent {
                        Text(event).lineLimit(1)
                    }
                    Button("Add Seat", systemImage: "plus") {
                        Task { await seats.addSeat() }
                    }
                    .buttonStyle(.borderless)
                }
            }
            if seats.seats.isEmpty {
                Text("–").foregroundStyle(.tertiary)
            }
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: SeatColumns.spacing) {
                    Text("").frame(minWidth: SeatColumns.seat, maxWidth: .infinity, alignment: .leading)
                    Text("Session").frame(width: SeatColumns.window, alignment: .leading)
                    Text("Week").frame(width: SeatColumns.window, alignment: .leading)
                    Text("By model").frame(width: SeatColumns.models, alignment: .leading)
                    Text("").frame(width: SeatColumns.action)
                }
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.tertiary)
                .padding(.bottom, 2)
                ForEach(seats.seats) { seat in
                    SeatRow(
                        seat: seat,
                        isActive: seat.id == seats.activeSeatID,
                        isBusy: seats.isSwitching,
                        onSwitch: { Task { await model.switchSeat(to: seat.id) } }
                    )
                    .contextMenu {
                        Button("Rename…") {
                            nickname = seat.nickname ?? ""
                            renaming = seat
                        }
                        Button("Copy Email") {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(seat.email, forType: .string)
                        }
                        Divider()
                        Button("Forget", role: .destructive) { seats.forget(seat.id) }
                            .disabled(seat.id == seats.activeSeatID)
                    }
                    if seat.id != seats.seats.last?.id {
                        Divider()
                    }
                }
            }
            IssueText(text: model.switchError ?? seats.credentialIssue)
        }
        .alert("Rename Seat", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $nickname)
            Button("Save") {
                if let renaming { seats.rename(renaming.id, to: nickname) }
            }
            Button("Cancel", role: .cancel) {}
        }
    }
}

private enum SeatColumns {
    static let spacing: CGFloat = 24
    static let seat: CGFloat = 220
    static let window: CGFloat = 230
    static let models: CGFloat = 150
    static let action: CGFloat = 80
}

private struct SeatRow: View {
    let seat: ClaudeSeat
    let isActive: Bool
    let isBusy: Bool
    let onSwitch: () -> Void

    var body: some View {
        HStack(spacing: SeatColumns.spacing) {
            HStack(spacing: 10) {
                Circle()
                    .fill(isActive ? Color.accentColor : .clear)
                    .strokeBorder(isActive ? Color.accentColor : .secondary.opacity(0.5), lineWidth: 1)
                    .frame(width: 8, height: 8)
                VStack(alignment: .leading, spacing: 2) {
                    Text(seat.title)
                        .font(.system(size: 13, weight: .semibold))
                    Text([seat.email, seat.organization].compactMap { $0 }.joined(separator: " · "))
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                    if let usage = seat.usage {
                        Text("Read \(Format.ago(usage.fetchedAt))")
                            .font(.system(size: 10))
                            .foregroundStyle(.tertiary)
                    }
                }
            }
            .frame(minWidth: SeatColumns.seat, maxWidth: .infinity, alignment: .leading)

            WindowReadout(label: "5h", window: seat.usage?.session)
                .frame(width: SeatColumns.window)
            WindowReadout(label: "7d", window: seat.usage?.week)
                .frame(width: SeatColumns.window)

            VStack(alignment: .leading, spacing: 4) {
                if seat.usage?.weekOpus == nil && seat.usage?.weekSonnet == nil {
                    Text("–").font(.system(size: 11)).foregroundStyle(.tertiary)
                }
                if let opus = seat.usage?.weekOpus {
                    WindowReadout(label: "O", window: opus, meterWidth: 60)
                }
                if let sonnet = seat.usage?.weekSonnet {
                    WindowReadout(label: "S", window: sonnet, meterWidth: 60)
                }
            }
            .frame(width: SeatColumns.models, alignment: .leading)

            HStack {
                Spacer(minLength: 0)
                if isActive {
                    Text("Active")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.accentColor)
                } else if seat.signedOut {
                    Text(seat.issue ?? "Signed out")
                        .font(.system(size: 11))
                        .foregroundStyle(.orange)
                } else {
                    Button("Switch", action: onSwitch)
                        .controlSize(.small)
                        .disabled(isBusy)
                }
            }
            .frame(width: SeatColumns.action)
        }
        .padding(.vertical, 10)
        .contentShape(.rect)
    }
}
