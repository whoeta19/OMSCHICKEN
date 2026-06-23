import SwiftUI

/// Все документы, по которым не учтены счета-фактуры — потенциальные вычеты по НДС.
struct DeductionGapsView: View {
    @Environment(AppRouter.self) private var router
    @State private var items: [TaxOverview.PendingDeduction] = []
    @State private var total: Double = 0

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                summary.appear(0)
                ForEach(Array(items.enumerated()), id: \.element.id) { idx, d in
                    gapRow(d).appear(idx + 1)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 120)
        }
        .scrollIndicators(.hidden)
        .background(Palette.canvas)
        .navigationTitle("Вычеты к заявлению")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Потенциальный вычет").font(Typo.caption).foregroundStyle(Palette.inkSoft)
            Typo.bigData("+\(money(String(total))) ₽")
                .foregroundStyle(Palette.positive)
                .contentTransition(.numericText())
            Text("Запросите счета-фактуры у контрагентов, чтобы заявить вычет")
                .font(Typo.caption).foregroundStyle(Palette.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .luxuryCard()
    }

    private func gapRow(_ d: TaxOverview.PendingDeduction) -> some View {
        Button {
            router.push(.documentDetail(id: d.documentId))
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text(d.number).font(Typo.headline).foregroundStyle(Palette.ink)
                    Text(d.counterparty ?? "—").font(Typo.caption).foregroundStyle(Palette.inkSoft)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 3) {
                    Text("+\(money(d.vatAmount)) ₽").font(Typo.mono).foregroundStyle(Palette.positive)
                    Text("нет СФ").font(Typo.caption).foregroundStyle(Palette.negative)
                }
            }
            .luxuryCard(padding: 16)
        }
        .buttonStyle(.pressable)
    }

    private func load() async {
        let fetched: TaxOverview? = try? await APIClient.shared.get("/tax/overview")
        let overview = fetched ?? TaxViewModel.demo
        items = overview.pendingDeductions
        total = items.compactMap { Double($0.vatAmount) }.reduce(0, +)
    }

    private func money(_ s: String?) -> String {
        guard let v = Double(s ?? "0") else { return "0" }
        let f = NumberFormatter(); f.numberStyle = .decimal; f.groupingSeparator = " "; f.maximumFractionDigits = 0
        return f.string(from: NSNumber(value: v)) ?? "\(Int(v))"
    }
}
