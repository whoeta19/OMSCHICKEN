import SwiftUI

@MainActor
@Observable
final class TasksViewModel {
    var summary: TaskSummary?
    var tasks: [TaskItem] = []
    var isLoading = true

    func load() async {
        isLoading = true
        defer { isLoading = false }
        // Демо-данные на случай отсутствия бэкенда; в проде — APIClient.
        async let s: TaskSummary? = try? await APIClient.shared.get("/tasks/summary")
        async let t: [TaskItem]? = try? await APIClient.shared.get("/tasks")
        summary = await s ?? TaskSummary(total: 3, overdue: 1, dueAmount: 86400)
        tasks = await t ?? Self.demo
    }

    static let demo: [TaskItem] = [
        .init(id: "1", kind: "TAX", status: "OPEN", title: "НДС за I квартал",
              subtitle: "Срок уплаты 28 апреля", amount: "86400", dueDate: "2026-04-28", deeplink: nil),
        .init(id: "2", kind: "REPORT", status: "OPEN", title: "Сдать ЕФС-1",
              subtitle: "Подраздел 1.1", amount: nil, dueDate: "2026-04-25", deeplink: nil),
        .init(id: "3", kind: "NAVIGATION", status: "OPEN", title: "Выставить счёт новому клиенту",
              subtitle: "Ассистент поможет за минуту", amount: nil, dueDate: nil, deeplink: "create/new"),
    ]
}

struct TasksView: View {
    @Environment(AppRouter.self) private var router
    @State private var vm = TasksViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                heroBlock.appear(0)

                Text("Налоги и взносы")
                    .font(Typo.headline).foregroundStyle(Palette.inkSoft)
                    .padding(.top, 4)

                ForEach(Array(vm.tasks.enumerated()), id: \.element.id) { i, task in
                    taskCard(task).appear(i + 1)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 120)
        }
        .scrollIndicators(.hidden)
        .background(Palette.canvas)
        .task { await vm.load() }
    }

    private var header: some View {
        Text("Задачи")
            .font(Typo.title)
            .foregroundStyle(Palette.ink)
            .padding(.top, 8)
    }

    // BIG DATA сверху экрана
    private var heroBlock: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("К уплате в этом месяце")
                .font(Typo.caption).foregroundStyle(Palette.inkSoft)
            Typo.bigData("\(formatted(vm.summary?.dueAmount ?? 0)) ₽")
                .foregroundStyle(Palette.ink)
                .contentTransition(.numericText())
            HStack(spacing: 14) {
                pill(icon: "checklist", text: "\(vm.summary?.total ?? 0) задач")
                if (vm.summary?.overdue ?? 0) > 0 {
                    pill(icon: "exclamationmark.circle", text: "\(vm.summary!.overdue) просрочено",
                         tint: Palette.negative)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .luxuryCard()
    }

    private func taskCard(_ task: TaskItem) -> some View {
        Button {
            if let dl = task.deeplink {
                router.handleDeeplink(dl)
            } else {
                router.push(.taskDetail(id: task.id))
            }
        } label: {
            HStack(spacing: 14) {
                ZStack {
                    Circle().fill(tint(task).opacity(0.14)).frame(width: 44, height: 44)
                    Image(systemName: icon(task))
                        .foregroundStyle(tint(task)).font(.system(size: 18, weight: .medium))
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(task.title).font(Typo.headline).foregroundStyle(Palette.ink)
                    if let sub = task.subtitle {
                        Text(sub).font(Typo.caption).foregroundStyle(Palette.inkSoft)
                    }
                }
                Spacer()
                if let amount = task.amount, let d = Double(amount) {
                    Text("\(formatted(d)) ₽").font(Typo.mono).foregroundStyle(Palette.ink)
                } else {
                    Image(systemName: "chevron.right").foregroundStyle(Palette.muted).font(.system(size: 13, weight: .semibold))
                }
            }
            .luxuryCard(padding: 16)
        }
        .buttonStyle(.pressable)
    }

    private func pill(icon: String, text: String, tint: Color = Palette.accentDeep) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 12, weight: .semibold))
            Text(text).font(Typo.caption)
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(tint.opacity(0.1), in: Capsule())
    }

    private func icon(_ t: TaskItem) -> String {
        switch t.kind { case "TAX": "percent"; case "REPORT": "doc.badge.arrow.up"; default: "sparkles" }
    }
    private func tint(_ t: TaskItem) -> Color {
        switch t.kind { case "TAX": Palette.accentDeep; case "REPORT": Palette.positive; default: Palette.accent }
    }
    private func formatted(_ v: Double) -> String {
        let f = NumberFormatter(); f.numberStyle = .decimal; f.groupingSeparator = " "; f.maximumFractionDigits = 0
        return f.string(from: NSNumber(value: v)) ?? "\(Int(v))"
    }
}
