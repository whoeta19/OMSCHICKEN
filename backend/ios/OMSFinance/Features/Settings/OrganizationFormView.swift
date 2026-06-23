import SwiftUI

/// Список организаций пользователя и добавление новой по ИНН.
struct OrganizationFormView: View {
    @State private var orgs: [Org] = Org.demo
    @State private var newInn = ""
    @State private var adding = false

    struct Org: Identifiable {
        let id = UUID()
        let name: String
        let inn: String
        let regime: String
        let kind: String
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ForEach(Array(orgs.enumerated()), id: \.element.id) { idx, org in
                    orgCard(org).appear(idx)
                }
                addCard.appear(orgs.count)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 120)
        }
        .scrollIndicators(.hidden)
        .background(Palette.canvas)
        .navigationTitle("Мои организации")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func orgCard(_ org: Org) -> some View {
        HStack(spacing: 14) {
            Text(String(org.name.prefix(2)).uppercased())
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .frame(width: 48, height: 48)
                .background(
                    LinearGradient(colors: [Palette.accent, Palette.accentDeep],
                                   startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                )
            VStack(alignment: .leading, spacing: 3) {
                Text(org.name).font(Typo.headline).foregroundStyle(Palette.ink)
                Text("\(org.kind) · ИНН \(org.inn)").font(Typo.caption).foregroundStyle(Palette.inkSoft)
                Text(org.regime).font(Typo.caption).foregroundStyle(Palette.accentDeep)
            }
            Spacer()
        }
        .luxuryCard(padding: 16)
    }

    private var addCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Добавить организацию").font(Typo.headline).foregroundStyle(Palette.ink)
            HStack(spacing: 10) {
                TextField("ИНН организации", text: $newInn)
                    .font(Typo.body).keyboardType(.numberPad)
                    .padding(.horizontal, 14).padding(.vertical, 12)
                    .background(Palette.canvas, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                Button { add() } label: {
                    if adding { PulseLoader() }
                    else {
                        Image(systemName: "plus")
                            .font(.system(size: 18, weight: .bold)).foregroundStyle(.white)
                            .frame(width: 44, height: 44)
                            .background(
                                LinearGradient(colors: [Palette.accent, Palette.accentDeep],
                                               startPoint: .top, endPoint: .bottom),
                                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                            )
                    }
                }
                .buttonStyle(.pressable)
                .disabled(newInn.count < 10)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .luxuryCard()
    }

    private func add() {
        withAnimation(Motion.fade) { adding = true }
        Task {
            try? await Task.sleep(for: .milliseconds(800))
            await MainActor.run {
                withAnimation(Motion.soft) {
                    orgs.append(.init(name: "ИП Новиков", inn: newInn, regime: "УСН «Доходы»", kind: "ИП"))
                    newInn = ""
                    adding = false
                }
            }
        }
    }
}

extension OrganizationFormView.Org {
    static let demo: [OrganizationFormView.Org] = [
        .init(name: "ООО «Тихая роскошь»", inn: "7707083893", regime: "ОСНО · плательщик НДС", kind: "ООО"),
    ]
}
