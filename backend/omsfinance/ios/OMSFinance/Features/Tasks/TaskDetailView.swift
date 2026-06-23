import SwiftUI

/// Детальный экран задачи: суть, срок, сумма и действие (перейти к оплате/созданию).
struct TaskDetailView: View {
    let taskId: String
    @Environment(AppRouter.self) private var router
    @State private var task: TaskItem?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header.appear(0)
                if let amount = task?.amount {
                    amountCard(amount).appear(1)
                }
                detailsCard.appear(2)
                actionButton.appear(3)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 120)
        }
        .scrollIndicators(.hidden)
        .background(Palette.canvas)
        .navigationTitle("Задача")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            kindBadge
            Text(task?.title ?? "Задача")
                .font(Typo.title)
                .foregroundStyle(Palette.ink)
            if let subtitle = task?.subtitle {
                Text(subtitle).font(Typo.body).foregroundStyle(Palette.inkSoft)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var kindBadge: some View {
        let kind = task?.kind ?? "TAX"
        let label: String = switch kind {
            case "TAX": "Налог"
            case "REPORT": "Отчётность"
            default: "Навигация"
        }
        return Text(label)
            .font(Typo.caption)
            .foregroundStyle(Palette.accentDeep)
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(Palette.accent.opacity(0.14), in: Capsule())
    }

    private func amountCard(_ amount: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("К уплате").font(Typo.caption).foregroundStyle(Palette.inkSoft)
            Typo.bigData("\(money(amount)) ₽")
                .foregroundStyle(Palette.ink)
                .contentTransition(.numericText())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .luxuryCard()
    }

    private var detailsCard: some View {
        VStack(spacing: 0) {
            detailRow("Срок", value: task?.dueDate ?? "—")
            divider
            detailRow("Статус", value: statusLabel)
        }
        .luxuryCard(padding: 0)
    }

    private func detailRow(_ title: String, value: String) -> some View {
        HStack {
            Text(title).font(Typo.body).foregroundStyle(Palette.inkSoft)
            Spacer()
            Text(value).font(Typo.headline).foregroundStyle(Palette.ink)
        }
        .padding(.horizontal, 20).padding(.vertical, 16)
    }

    private var divider: some View {
        Rectangle().fill(Palette.hairline).frame(height: 1).padding(.horizontal, 20)
    }

    private var actionButton: some View {
        Button {
            if let deeplink = task?.deeplink { router.handleDeeplink(deeplink) }
        } label: {
            Text("Перейти к выполнению")
                .font(Typo.headline)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(
                    LinearGradient(colors: [Palette.accent, Palette.accentDeep],
                                   startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 18, style: .continuous)
                )
        }
        .buttonStyle(.pressable)
    }

    private var statusLabel: String {
        switch task?.status ?? "OPEN" {
        case "DONE": "Выполнено"
        case "OVERDUE": "Просрочено"
        default: "Открыто"
        }
    }

    private func load() async {
        task = (try? await APIClient.shared.get("/tasks/\(taskId)")) ?? Self.demo(taskId)
    }

    private static func demo(_ id: String) -> TaskItem {
        .init(id: id, kind: "TAX", status: "OPEN",
              title: "Уплатить НДС за I квартал",
              subtitle: "Единый налоговый платёж до 28 числа",
              amount: "86400.00", dueDate: "28 апреля 2026", deeplink: "tax/2026Q1")
    }

    private func money(_ s: String?) -> String {
        guard let v = Double(s ?? "0") else { return "0" }
        let f = NumberFormatter(); f.numberStyle = .decimal; f.groupingSeparator = " "; f.maximumFractionDigits = 0
        return f.string(from: NSNumber(value: v)) ?? "\(Int(v))"
    }
}
