import SwiftUI

@MainActor
@Observable
final class TaxViewModel {
    var overview: TaxOverview?
    func load() async {
        overview = (try? await APIClient.shared.get("/tax/overview")) ?? Self.demo
    }
    static let demo = TaxOverview(
        ensBalance: "124500.00", vatToPay: "86400.00",
        vatOutgoing: "142000.00", vatIncoming: "61200.00", vatDeductible: "55600.00",
        pendingDeductions: [
            .init(documentId: "d1", number: "УПД-204", counterparty: "ООО «Поставка»", vatAmount: "5600.00"),
            .init(documentId: "d2", number: "СФ-77", counterparty: "ИП Кузнецов", vatAmount: "3200.00"),
        ]
    )
}

struct TaxView: View {
    @Environment(AppRouter.self) private var router
    @State private var vm = TaxViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Налог").font(Typo.title).foregroundStyle(Palette.ink).padding(.top, 8)

                ensRow.appear(0)
                vatHero.appear(1)
                inOutRow.appear(2)
                deductions.appear(3)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 120)
        }
        .scrollIndicators(.hidden)
        .background(Palette.canvas)
        .task { await vm.load() }
    }

    // Сальдо ЕНС — небольшим шрифтом сверху
    private var ensRow: some View {
        HStack {
            Text("Сальдо ЕНС").font(Typo.caption).foregroundStyle(Palette.inkSoft)
            Spacer()
            Text("\(money(vm.overview?.ensBalance)) ₽")
                .font(Typo.mono)
                .foregroundStyle(positive(vm.overview?.ensBalance) ? Palette.positive : Palette.negative)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(Palette.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(
            LinearGradient(
                colors: [.white.opacity(0.85), Palette.hairline.opacity(0.5), Palette.hairline.opacity(0.2)],
                startPoint: .top, endPoint: .bottom
            ), lineWidth: 1
        ))
    }

    // НДС к уплате — BIG
    private var vatHero: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("НДС к уплате").font(Typo.caption).foregroundStyle(Palette.inkSoft)
            Typo.bigData("\(money(vm.overview?.vatToPay)) ₽")
                .foregroundStyle(Palette.ink)
                .contentTransition(.numericText())
            Text("за I квартал 2026").font(Typo.caption).foregroundStyle(Palette.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .luxuryCard()
    }

    private var inOutRow: some View {
        HStack(spacing: 14) {
            vatStat(title: "Исходящий", value: vm.overview?.vatOutgoing, icon: "arrow.up.right", tint: Palette.accentDeep)
            vatStat(title: "Входящий", value: vm.overview?.vatIncoming, icon: "arrow.down.left", tint: Palette.positive)
        }
    }

    private func vatStat(title: String, value: String?, icon: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon).foregroundStyle(tint).font(.system(size: 14, weight: .semibold))
                Text(title).font(Typo.caption).foregroundStyle(Palette.inkSoft)
            }
            Text("\(money(value)) ₽").font(.system(size: 20, weight: .semibold, design: .rounded))
                .foregroundStyle(Palette.ink)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .luxuryCard(padding: 16)
    }

    // Варианты вычета: документы без счёта-фактуры
    private var deductions: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Можно заявить к вычету").font(Typo.headline).foregroundStyle(Palette.ink)
                Spacer()
                Button("Все") { router.push(.deductionGaps) }
                    .font(Typo.caption).foregroundStyle(Palette.accentDeep)
            }
            Text("В этих документах не учтены счета-фактуры")
                .font(Typo.caption).foregroundStyle(Palette.inkSoft)

            ForEach(vm.overview?.pendingDeductions ?? []) { d in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(d.number).font(Typo.headline).foregroundStyle(Palette.ink)
                        Text(d.counterparty ?? "—").font(Typo.caption).foregroundStyle(Palette.inkSoft)
                    }
                    Spacer()
                    Text("+\(money(d.vatAmount)) ₽").font(Typo.mono).foregroundStyle(Palette.positive)
                }
                .padding(.vertical, 10)
                .overlay(alignment: .bottom) {
                    if d.id != vm.overview?.pendingDeductions.last?.id {
                        Rectangle().fill(Palette.hairline).frame(height: 1)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .luxuryCard()
    }

    // Helpers
    private func money(_ s: String?) -> String {
        guard let v = Double(s ?? "0") else { return "0" }
        let f = NumberFormatter(); f.numberStyle = .decimal; f.groupingSeparator = " "; f.maximumFractionDigits = 0
        return f.string(from: NSNumber(value: v)) ?? "\(Int(v))"
    }
    private func positive(_ s: String?) -> Bool { (Double(s ?? "0") ?? 0) >= 0 }
}
