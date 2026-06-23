import SwiftUI

/// Карточка отправленного отчёта (ФНС/СФР/ПФР/ЕФС): статус приёма, протокол, квитанция.
struct ReportDetailView: View {
    let reportId: String
    @State private var report: ReportDTO?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header.appear(0)
                statusCard.appear(1)
                timeline.appear(2)
                actions.appear(3)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 120)
        }
        .scrollIndicators(.hidden)
        .background(Palette.canvas)
        .navigationTitle("Отчёт")
        .navigationBarTitleDisplayMode(.inline)
        .task { report = (try? await APIClient.shared.get("/fns/reports/\(reportId)")) ?? Self.demo }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            destinationBadge
            Text(report?.title ?? "Отчёт").font(Typo.title).foregroundStyle(Palette.ink)
            Text("Период: \(report?.period ?? "—")").font(Typo.caption).foregroundStyle(Palette.inkSoft)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var destinationBadge: some View {
        Text(report?.destination ?? "ФНС")
            .font(Typo.caption).foregroundStyle(Palette.accentDeep)
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(Palette.accent.opacity(0.14), in: Capsule())
    }

    private var statusCard: some View {
        HStack {
            Image(systemName: statusIcon).foregroundStyle(statusColor).font(.system(size: 20, weight: .semibold))
            VStack(alignment: .leading, spacing: 2) {
                Text(statusLabel).font(Typo.headline).foregroundStyle(Palette.ink)
                Text("Документооборот завершён").font(Typo.caption).foregroundStyle(Palette.inkSoft)
            }
            Spacer()
        }
        .luxuryCard()
    }

    private var timeline: some View {
        VStack(alignment: .leading, spacing: 0) {
            step("Отправлен оператору", done: true, last: false)
            step("Принят оператором ЭДО", done: true, last: false)
            step("Доставлен в \(report?.destination ?? "ФНС")", done: true, last: false)
            step("Квитанция о приёме получена", done: status == "ACCEPTED", last: true)
        }
        .luxuryCard()
    }

    private func step(_ title: String, done: Bool, last: Bool) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 0) {
                Circle().fill(done ? Palette.positive : Palette.muted).frame(width: 12, height: 12)
                if !last { Rectangle().fill(Palette.hairline).frame(width: 1.5, height: 28) }
            }
            Text(title).font(Typo.body).foregroundStyle(done ? Palette.ink : Palette.inkSoft)
                .padding(.bottom, last ? 0 : 16)
            Spacer()
        }
    }

    private var actions: some View {
        Button { } label: {
            Text("Скачать квитанцию")
                .font(Typo.headline).foregroundStyle(Palette.ink)
                .frame(maxWidth: .infinity).padding(.vertical, 16)
                .background(Palette.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(LinearGradient(colors: [.white.opacity(0.85), Palette.hairline.opacity(0.5), Palette.hairline.opacity(0.2)], startPoint: .top, endPoint: .bottom), lineWidth: 1))
        }
        .buttonStyle(.pressable)
    }

    private var status: String { report?.status ?? "ACCEPTED" }
    private var statusLabel: String {
        switch status {
        case "ACCEPTED": "Принят"
        case "REJECTED": "Отклонён"
        case "SENT": "Отправлен"
        default: "В обработке"
        }
    }
    private var statusIcon: String {
        switch status {
        case "ACCEPTED": "checkmark.seal.fill"
        case "REJECTED": "xmark.seal.fill"
        default: "paperplane.fill"
        }
    }
    private var statusColor: Color {
        switch status {
        case "ACCEPTED": Palette.positive
        case "REJECTED": Palette.negative
        default: Palette.accentDeep
        }
    }

    private static let demo = ReportDTO(
        id: "r1", destination: "ФНС", title: "Декларация по НДС",
        period: "I квартал 2026", status: "ACCEPTED"
    )
}
