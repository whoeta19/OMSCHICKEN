import SwiftUI

@MainActor
@Observable
final class FnsViewModel {
    var messages: [FnsMessageDTO] = []
    var reports: [ReportDTO] = []
    func load() async {
        messages = (try? await APIClient.shared.get("/fns/messages")) ?? Self.demoMsg
        reports = (try? await APIClient.shared.get("/fns/reports")) ?? Self.demoRep
    }
    static let demoMsg: [FnsMessageDTO] = [
        .init(id: "1", kind: "REQUIREMENT", subject: "Требование о представлении пояснений", isRead: false, dueDate: "2026-04-12"),
        .init(id: "2", kind: "LETTER", subject: "Информационное письмо о ЕНС", isRead: true, dueDate: nil),
    ]
    static let demoRep: [ReportDTO] = [
        .init(id: "1", destination: "FNS", title: "Декларация по НДС", period: "2026 Q1", status: "ACCEPTED"),
        .init(id: "2", destination: "SFR", title: "ЕФС-1, подраздел 1.1", period: "2026 03", status: "SENT"),
        .init(id: "3", destination: "EFS", title: "Сведения о трудовой деятельности", period: "2026 03", status: "PREPARED"),
    ]
}

struct FnsView: View {
    @Environment(AppRouter.self) private var router
    @State private var vm = FnsViewModel()
    @State private var segment = 0

    var body: some View {
        VStack(spacing: 0) {
            Text("ФНС").font(Typo.title).foregroundStyle(Palette.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20).padding(.top, 8)

            picker.padding(.horizontal, 20).padding(.vertical, 14)

            ScrollView {
                VStack(spacing: 12) {
                    if segment == 0 {
                        ForEach(Array(vm.messages.enumerated()), id: \.element.id) { i, m in
                            messageRow(m).appear(i)
                        }
                    } else {
                        ForEach(Array(vm.reports.enumerated()), id: \.element.id) { i, r in
                            reportRow(r).appear(i)
                        }
                    }
                }
                .padding(.horizontal, 20).padding(.bottom, 120)
            }
            .scrollIndicators(.hidden)
        }
        .background(Palette.canvas)
        .task { await vm.load() }
    }

    private var picker: some View {
        HStack(spacing: 0) {
            segmentButton("Письма", 0)
            segmentButton("Отчёты", 1)
        }
        .padding(4)
        .background(Palette.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(
            LinearGradient(
                colors: [.white.opacity(0.85), Palette.hairline.opacity(0.5), Palette.hairline.opacity(0.2)],
                startPoint: .top, endPoint: .bottom
            ), lineWidth: 1
        ))
    }

    private func segmentButton(_ title: String, _ idx: Int) -> some View {
        Button { withAnimation(Motion.snappy) { segment = idx } } label: {
            Text(title).font(Typo.headline)
                .foregroundStyle(segment == idx ? .white : Palette.inkSoft)
                .frame(maxWidth: .infinity).frame(height: 38)
                .background {
                    if segment == idx {
                        Capsule().fill(LinearGradient(colors: [Palette.accent, Palette.accentDeep],
                                                      startPoint: .leading, endPoint: .trailing))
                    }
                }
        }.buttonStyle(.pressable)
    }

    private func messageRow(_ m: FnsMessageDTO) -> some View {
        Button { router.push(.fnsMessage(id: m.id)) } label: {
            HStack(spacing: 14) {
                ZStack {
                    Circle().fill((m.kind == "REQUIREMENT" ? Palette.negative : Palette.accentDeep).opacity(0.12))
                        .frame(width: 44, height: 44)
                    Image(systemName: m.kind == "REQUIREMENT" ? "exclamationmark.bubble" : "envelope")
                        .foregroundStyle(m.kind == "REQUIREMENT" ? Palette.negative : Palette.accentDeep)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(m.subject).font(Typo.headline).foregroundStyle(Palette.ink).lineLimit(2)
                    if let due = m.dueDate {
                        Text("Срок ответа: \(due)").font(Typo.caption).foregroundStyle(Palette.inkSoft)
                    }
                }
                Spacer()
                if !m.isRead { Circle().fill(Palette.accent).frame(width: 8, height: 8) }
            }
            .luxuryCard(padding: 16)
        }.buttonStyle(.pressable)
    }

    private func reportRow(_ r: ReportDTO) -> some View {
        Button { router.push(.reportDetail(id: r.id)) } label: {
            HStack(spacing: 14) {
                Text(r.destination).font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Palette.accentDeep)
                    .frame(width: 44, height: 44)
                    .background(Palette.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text(r.title).font(Typo.headline).foregroundStyle(Palette.ink)
                    Text(r.period).font(Typo.caption).foregroundStyle(Palette.inkSoft)
                }
                Spacer()
                reportStatus(r.status)
            }
            .luxuryCard(padding: 16)
        }.buttonStyle(.pressable)
    }

    private func reportStatus(_ s: String) -> some View {
        let (t, c): (String, Color) = switch s {
        case "ACCEPTED": ("принят", Palette.positive)
        case "SENT": ("отправлен", Palette.accentDeep)
        case "REJECTED": ("отклонён", Palette.negative)
        default: ("готов", Palette.muted)
        }
        return Text(t).font(.system(size: 11, weight: .medium)).foregroundStyle(c)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(c.opacity(0.12), in: Capsule())
    }
}
