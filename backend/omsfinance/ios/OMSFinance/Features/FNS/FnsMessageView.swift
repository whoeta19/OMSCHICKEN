import SwiftUI

/// Просмотр письма или требования ФНС с возможностью ответить/приложить документы.
struct FnsMessageView: View {
    let messageId: String
    @State private var message: FnsMessageDTO?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header.appear(0)
                bodyCard.appear(1)
                if message?.kind == "REQUIREMENT" { dueCard.appear(2) }
                actions.appear(3)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 120)
        }
        .scrollIndicators(.hidden)
        .background(Palette.canvas)
        .navigationTitle(kindTitle)
        .navigationBarTitleDisplayMode(.inline)
        .task { message = (try? await APIClient.shared.get("/fns/messages/\(messageId)")) ?? Self.demo }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            kindBadge
            Text(message?.subject ?? "Сообщение").font(Typo.title).foregroundStyle(Palette.ink)
            Text("ИФНС России № 7707").font(Typo.caption).foregroundStyle(Palette.inkSoft)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var kindBadge: some View {
        let isReq = message?.kind == "REQUIREMENT"
        return Text(isReq ? "Требование" : "Письмо")
            .font(Typo.caption)
            .foregroundStyle(isReq ? Palette.negative : Palette.accentDeep)
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background((isReq ? Palette.negative : Palette.accent).opacity(0.14), in: Capsule())
    }

    private var bodyCard: some View {
        Text("Налоговый орган просит представить пояснения по декларации НДС за I квартал 2026 года в части расхождений по счетам-фактурам с контрагентами. Ответ направьте через оператора ЭДО.")
            .font(Typo.body).foregroundStyle(Palette.ink)
            .frame(maxWidth: .infinity, alignment: .leading)
            .luxuryCard()
    }

    private var dueCard: some View {
        HStack {
            Image(systemName: "clock.badge.exclamationmark").foregroundStyle(Palette.negative)
            Text("Ответить до \(message?.dueDate ?? "—")").font(Typo.headline).foregroundStyle(Palette.ink)
            Spacer()
        }
        .luxuryCard(padding: 16)
    }

    private var actions: some View {
        Button { } label: {
            Text("Подготовить ответ")
                .font(Typo.headline).foregroundStyle(.white)
                .frame(maxWidth: .infinity).padding(.vertical, 16)
                .background(
                    LinearGradient(colors: [Palette.accent, Palette.accentDeep],
                                   startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 18, style: .continuous)
                )
        }
        .buttonStyle(.pressable)
    }

    private var kindTitle: String { message?.kind == "REQUIREMENT" ? "Требование" : "Письмо" }

    private static let demo = FnsMessageDTO(
        id: "m1", kind: "REQUIREMENT",
        subject: "О представлении пояснений по НДС",
        isRead: false, dueDate: "05.05.2026"
    )
}
