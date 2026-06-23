import SwiftUI

/// Предпросмотр сгенерированного документа: PDF-форма, выгрузка XML по формату ФНС,
/// добавление печати/подписи и отправка контрагенту.
struct DocumentPreviewView: View {
    let documentId: String
    @Environment(AppRouter.self) private var router
    @State private var doc: DocumentDTO?
    @State private var format: Format = .pdf
    @State private var signed = false

    enum Format: String, CaseIterable { case pdf = "PDF", xml = "XML" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                formatPicker.appear(0)
                preview.appear(1)
                signRow.appear(2)
                actions.appear(3)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 120)
        }
        .scrollIndicators(.hidden)
        .background(Palette.canvas)
        .navigationTitle("Предпросмотр")
        .navigationBarTitleDisplayMode(.inline)
        .task { doc = (try? await APIClient.shared.get("/documents/\(documentId)")) ?? Self.demo }
    }

    private var formatPicker: some View {
        HStack(spacing: 0) {
            ForEach(Format.allCases, id: \.self) { f in
                Button { withAnimation(Motion.snappy) { format = f } } label: {
                    Text(f.rawValue)
                        .font(Typo.headline)
                        .foregroundStyle(format == f ? .white : Palette.inkSoft)
                        .frame(maxWidth: .infinity).padding(.vertical, 10)
                        .background {
                            if format == f {
                                LinearGradient(colors: [Palette.accent, Palette.accentDeep],
                                               startPoint: .leading, endPoint: .trailing)
                                    .clipShape(Capsule())
                            }
                        }
                }
                .buttonStyle(.pressable)
            }
        }
        .padding(4)
        .background(Palette.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(LinearGradient(colors: [.white.opacity(0.85), Palette.hairline.opacity(0.5), Palette.hairline.opacity(0.2)], startPoint: .top, endPoint: .bottom), lineWidth: 1))
    }

    private var preview: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(doc?.number ?? "—").font(Typo.title).foregroundStyle(Palette.ink)
                Spacer()
                Image(systemName: format == .pdf ? "doc.richtext" : "chevron.left.forwardslash.chevron.right")
                    .foregroundStyle(Palette.accentDeep)
            }
            Rectangle().fill(Palette.hairline).frame(height: 1)
            if format == .pdf { pdfMock } else { xmlMock }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .luxuryCard()
    }

    private var pdfMock: some View {
        VStack(alignment: .leading, spacing: 8) {
            previewLine("Поставщик", doc?.counterparty?.name ?? "ООО «Тихая роскошь»")
            previewLine("Покупатель", "ООО «Клиент»")
            previewLine("Сумма", "\(doc?.amountTotal ?? "0") ₽")
            previewLine("в т.ч. НДС 20 %", "23 666,67 ₽")
            if signed {
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.seal.fill").foregroundStyle(Palette.positive)
                    Text("Подписано ЭЦП · печать организации").font(Typo.caption).foregroundStyle(Palette.positive)
                }
                .padding(.top, 4)
                .transition(.opacity.combined(with: .scale(scale: 0.96)))
            }
        }
    }

    private var xmlMock: some View {
        Text("""
        <?xml version="1.0" encoding="windows-1251"?>
        <Файл ИдФайл="ON_NSCHFDOPPR_..." ВерсФорм="5.03">
          <Документ КНД="1115131" Функция="СЧФДОП">
            <СвСчФакт НомерДок="\(doc?.number ?? "205")" />
          </Документ>
        </Файл>
        """)
        .font(Typo.mono)
        .foregroundStyle(Palette.inkSoft)
        .padding(12)
        .background(Palette.canvas, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func previewLine(_ k: String, _ v: String) -> some View {
        HStack {
            Text(k).font(Typo.caption).foregroundStyle(Palette.inkSoft)
            Spacer()
            Text(v).font(Typo.body).foregroundStyle(Palette.ink)
        }
    }

    private var signRow: some View {
        Button { withAnimation(Motion.soft) { signed.toggle() } } label: {
            HStack {
                Image(systemName: signed ? "checkmark.seal.fill" : "signature")
                    .foregroundStyle(signed ? Palette.positive : Palette.accentDeep)
                Text(signed ? "Печать и подпись добавлены" : "Добавить печать и подпись")
                    .font(Typo.headline).foregroundStyle(Palette.ink)
                Spacer()
            }
            .luxuryCard(padding: 16)
        }
        .buttonStyle(.pressable)
    }

    private var actions: some View {
        VStack(spacing: 12) {
            Button { } label: {
                Text("Отправить контрагенту")
                    .font(Typo.headline).foregroundStyle(.white)
                    .frame(maxWidth: .infinity).padding(.vertical, 16)
                    .background(
                        LinearGradient(colors: [Palette.accent, Palette.accentDeep],
                                       startPoint: .topLeading, endPoint: .bottomTrailing),
                        in: RoundedRectangle(cornerRadius: 18, style: .continuous)
                    )
            }
            .buttonStyle(.pressable)

            Button { } label: {
                Text("Скачать \(format.rawValue)")
                    .font(Typo.headline).foregroundStyle(Palette.ink)
                    .frame(maxWidth: .infinity).padding(.vertical, 16)
                    .background(Palette.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(LinearGradient(colors: [.white.opacity(0.85), Palette.hairline.opacity(0.5), Palette.hairline.opacity(0.2)], startPoint: .top, endPoint: .bottom), lineWidth: 1))
            }
            .buttonStyle(.pressable)
        }
    }

    private static let demo = DocumentDTO(
        id: "d-preview", type: "UPD", status: "DRAFT", number: "УПД-205",
        issueDate: "2026-03-20", amountTotal: "142000.00",
        counterparty: .init(name: "ООО «Тихая роскошь»", inn: "7707083893")
    )
}
