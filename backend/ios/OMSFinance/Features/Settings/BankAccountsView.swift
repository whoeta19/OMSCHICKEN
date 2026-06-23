import SwiftUI

/// Подключённые расчётные счета. Подключение банка для автоматической загрузки выписок.
struct BankAccountsView: View {
    @State private var accounts: [Account] = Account.demo

    struct Account: Identifiable {
        let id = UUID()
        let bank: String
        let number: String
        let connected: Bool
    }

    private let banks = ["Т-Банк", "Сбербанк", "Альфа-Банк", "ВТБ", "Точка"]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if !accounts.isEmpty {
                    sectionTitle("Подключённые счета")
                    ForEach(Array(accounts.enumerated()), id: \.element.id) { idx, acc in
                        accountCard(acc).appear(idx)
                    }
                }
                sectionTitle("Подключить банк").padding(.top, 6)
                banksGrid.appear(accounts.count)
                note.appear(accounts.count + 1)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 120)
        }
        .scrollIndicators(.hidden)
        .background(Palette.canvas)
        .navigationTitle("Расчётные счета")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func sectionTitle(_ t: String) -> some View {
        Text(t.uppercased())
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Palette.muted)
            .padding(.leading, 4)
    }

    private func accountCard(_ acc: Account) -> some View {
        HStack(spacing: 14) {
            Image(systemName: "building.columns.fill")
                .foregroundStyle(Palette.accentDeep)
                .frame(width: 44, height: 44)
                .background(Palette.accent.opacity(0.14), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(acc.bank).font(Typo.headline).foregroundStyle(Palette.ink)
                Text("счёт •••• \(acc.number.suffix(4))").font(Typo.caption).foregroundStyle(Palette.inkSoft)
            }
            Spacer()
            HStack(spacing: 6) {
                Circle().fill(Palette.positive).frame(width: 7, height: 7)
                Text("выписки").font(Typo.caption).foregroundStyle(Palette.positive)
            }
        }
        .luxuryCard(padding: 16)
    }

    private var banksGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            ForEach(banks, id: \.self) { bank in
                Button { connect(bank) } label: {
                    HStack {
                        Text(bank).font(Typo.body).foregroundStyle(Palette.ink)
                        Spacer()
                        Image(systemName: "plus.circle.fill").foregroundStyle(Palette.accent)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 14)
                    .background(Palette.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(LinearGradient(colors: [.white.opacity(0.85), Palette.hairline.opacity(0.5), Palette.hairline.opacity(0.2)], startPoint: .top, endPoint: .bottom), lineWidth: 1))
                }
                .buttonStyle(.pressable)
            }
        }
    }

    private var note: some View {
        Text("Подключение происходит по защищённому протоколу банка. OMSFinance получает только выписки — управление средствами недоступно.")
            .font(Typo.caption).foregroundStyle(Palette.muted)
            .padding(.horizontal, 4).padding(.top, 6)
    }

    private func connect(_ bank: String) {
        withAnimation(Motion.soft) {
            accounts.append(.init(bank: bank, number: "40702810\(Int.random(in: 1000...9999))", connected: true))
        }
    }
}

extension BankAccountsView.Account {
    static let demo: [BankAccountsView.Account] = [
        .init(bank: "Т-Банк", number: "40702810500001234567", connected: true),
    ]
}
