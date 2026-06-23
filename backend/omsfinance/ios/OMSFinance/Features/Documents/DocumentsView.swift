import SwiftUI

@MainActor
@Observable
final class DocumentsViewModel {
    var documents: [DocumentDTO] = []
    func load() async {
        documents = (try? await APIClient.shared.get("/documents")) ?? Self.demo
    }
    static let demo: [DocumentDTO] = [
        .init(id: "1", type: "UPD", status: "SIGNED", number: "УПД-204", issueDate: "2026-03-18",
              amountTotal: "168000.00", counterparty: .init(name: "ООО «Клиент»", inn: "7701234567")),
        .init(id: "2", type: "BILL", status: "SENT", number: "Счёт-512", issueDate: "2026-03-15",
              amountTotal: "42000.00", counterparty: .init(name: "ИП Смирнов", inn: "770112345678")),
        .init(id: "3", type: "ACT", status: "PAID", number: "Акт-77", issueDate: "2026-03-10",
              amountTotal: "95000.00", counterparty: .init(name: "ООО «Партнёр»", inn: "7705557788")),
    ]
}

struct DocumentsView: View {
    @Environment(AppRouter.self) private var router
    @State private var vm = DocumentsViewModel()
    @Namespace private var ns

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Документы").font(Typo.title).foregroundStyle(Palette.ink)
                    .padding(.top, 8)
                ForEach(Array(vm.documents.enumerated()), id: \.element.id) { i, doc in
                    Button { router.push(.documentDetail(id: doc.id)) } label: {
                        row(doc)
                    }
                    .buttonStyle(.pressable)
                    .appear(i)
                }
            }
            .padding(.horizontal, 20).padding(.bottom, 120)
        }
        .scrollIndicators(.hidden)
        .background(Palette.canvas)
        .task { await vm.load() }
    }

    private func row(_ doc: DocumentDTO) -> some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Palette.accent.opacity(0.12)).frame(width: 44, height: 44)
                Image(systemName: "doc.text").foregroundStyle(Palette.accentDeep)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(doc.number).font(Typo.headline).foregroundStyle(Palette.ink)
                Text(doc.counterparty?.name ?? "—").font(Typo.caption).foregroundStyle(Palette.inkSoft)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text("\(doc.amountTotal) ₽").font(Typo.mono).foregroundStyle(Palette.ink)
                statusBadge(doc.status)
            }
        }
        .luxuryCard(padding: 16)
    }

    private func statusBadge(_ status: String) -> some View {
        let (text, color): (String, Color) = switch status {
        case "SIGNED": ("подписан", Palette.positive)
        case "SENT": ("отправлен", Palette.accentDeep)
        case "PAID": ("оплачен", Palette.positive)
        default: ("черновик", Palette.muted)
        }
        return Text(text).font(.system(size: 11, weight: .medium))
            .foregroundStyle(color)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.12), in: Capsule())
    }
}
