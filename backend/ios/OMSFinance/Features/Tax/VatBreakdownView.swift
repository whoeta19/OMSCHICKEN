import SwiftUI

/// Детальная разбивка НДС за период: исходящий, входящий, к вычету, к уплате.
struct VatBreakdownView: View {
    let period: String
    @State private var overview: TaxOverview?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text(periodTitle).font(Typo.title).foregroundStyle(Palette.ink).appear(0)

                toPayCard.appear(1)
                breakdownCard.appear(2)
                formulaNote.appear(3)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 120)
        }
        .scrollIndicators(.hidden)
        .background(Palette.canvas)
        .navigationTitle("Разбивка НДС")
        .navigationBarTitleDisplayMode(.inline)
        .task { overview = (try? await APIClient.shared.get("/tax/overview", query: ["period": period])) ?? TaxViewModel.demo }
    }

    private var toPayCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("НДС к уплате").font(Typo.caption).foregroundStyle(Palette.inkSoft)
            Typo.bigData("\(money(overview?.vatToPay)) ₽")
                .foregroundStyle(Palette.ink)
                .contentTransition(.numericText())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .luxuryCard()
    }

    private var breakdownCard: some View {
        VStack(spacing: 0) {
            row("Исходящий НДС", value: overview?.vatOutgoing, tint: Palette.accentDeep)
            divider
            row("Входящий НДС", value: overview?.vatIncoming, tint: Palette.positive)
            divider
            row("Принято к вычету", value: overview?.vatDeductible, tint: Palette.positive)
        }
        .luxuryCard(padding: 0)
    }

    private func row(_ title: String, value: String?, tint: Color) -> some View {
        HStack {
            Text(title).font(Typo.body).foregroundStyle(Palette.inkSoft)
            Spacer()
            Text("\(money(value)) ₽").font(Typo.mono).foregroundStyle(tint)
        }
        .padding(.horizontal, 20).padding(.vertical, 16)
    }

    private var formulaNote: some View {
        Text("К уплате = исходящий − принятый к вычету. Уменьшить сумму можно, заявив вычеты по недостающим счетам-фактурам.")
            .font(Typo.caption)
            .foregroundStyle(Palette.inkSoft)
            .padding(.horizontal, 4)
    }

    private var divider: some View {
        Rectangle().fill(Palette.hairline).frame(height: 1).padding(.horizontal, 20)
    }

    private var periodTitle: String {
        period.contains("Q") ? period.replacingOccurrences(of: "Q", with: " квартал ") : period
    }

    private func money(_ s: String?) -> String {
        guard let v = Double(s ?? "0") else { return "0" }
        let f = NumberFormatter(); f.numberStyle = .decimal; f.groupingSeparator = " "; f.maximumFractionDigits = 0
        return f.string(from: NSNumber(value: v)) ?? "\(Int(v))"
    }
}
