import SwiftUI

/// Карточка документа: реквизиты, контрагент, суммы и действия (предпросмотр, выгрузка).
struct DocumentDetailView: View {
    let documentId: String
    @Environment(AppRouter.self) private var router
    @State private var doc: DocumentDTO?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header.appear(0)
                amountCard.appear(1)
                detailsCard.appear(2)
                openPreview.appear(3)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 120)
        }
        .scrollIndicators(.hidden)
        .background(Palette.canvas)
        .navigationTitle("Документ")
        .navigationBarTitleDisplayMode(.inline)
        .task { doc = (try? await APIClient.shared.get("/documents/\(documentId)")) ?? Self.demo }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            statusBadge
            Text(doc?.number ?? "Документ").font(Typo.title).foregroundStyle(Palette.ink)
            Text(typeLabel).font(Typo.body).foregroundStyle(Palette.inkSoft)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var statusBadge: some View {
        let status = doc?.status ?? "DRAFT"
        let (label, color): (String, Color) = switch status {
            case "SIGNED": ("Подписан", Palette.positive)
            case "SENT": ("Отправлен", Palette.accentDeep)
            case "PAID": ("Оплачен", Palette.positive)
            default: ("Черновик", Palette.muted)
        }
        return Text(label)
            .font(Typo.caption).foregroundStyle(color)
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(color.opacity(0.14), in: Capsule())
    }

    private var amountCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Сумма документа").font(Typo.caption).foregroundStyle(Palette.inkSoft)
            Typo.bigData("\(money(doc?.amountTotal)) ₽").foregroundStyle(Palette.ink)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .luxuryCard()
    }

    private var detailsCard: some View {
        VStack(spacing: 0) {
            row("Дата", doc?.issueDate ?? "—")
            divider
            row("Контрагент", doc?.counterparty?.name ?? "—")
            divider
            row("ИНН", doc?.counterparty?.inn ?? "—")
        }
        .luxuryCard(padding: 0)
    }

    private func row(_ k: String, _ v: String) -> some View {
        HStack {
            Text(k).font(Typo.body).foregroundStyle(Palette.inkSoft)
            Spacer()
            Text(v).font(Typo.headline).foregroundStyle(Palette.ink)
        }
        .padding(.horizontal, 20).padding(.vertical, 16)
    }

    private var divider: some View {
        Rectangle().fill(Palette.hairline).frame(height: 1).padding(.horizontal, 20)
    }

    private var openPreview: some View {
        Button { router.push(.documentPreview(id: documentId)) } label: {
            Text("Открыть предпросмотр")
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

    private var typeLabel: String {
        switch doc?.type ?? "" {
        case "UPD": "Универсальный передаточный документ"
        case "INVOICE": "Счёт-фактура"
        case "BILL": "Счёт на оплату"
        case "ACT": "Акт выполненных работ"
        case "TORG12": "Товарная накладная ТОРГ-12"
        case "CONTRACT": "Договор"
        default: "Первичный документ"
        }
    }

    private static let demo = DocumentDTO(
        id: "d-detail", type: "UPD", status: "SIGNED", number: "УПД-204",
        issueDate: "15.03.2026", amountTotal: "142000.00",
        counterparty: .init(name: "ООО «Поставка»", inn: "7707083893")
    )

    private func money(_ s: String?) -> String {
        guard let v = Double(s ?? "0") else { return "0" }
        let f = NumberFormatter(); f.numberStyle = .decimal; f.groupingSeparator = " "; f.maximumFractionDigits = 0
        return f.string(from: NSNumber(value: v)) ?? "\(Int(v))"
    }
}
