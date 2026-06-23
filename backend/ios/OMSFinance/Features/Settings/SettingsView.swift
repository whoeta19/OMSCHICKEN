import SwiftUI

/// Корневой экран настроек. Открывается из блеклой шестерёнки в правом верхнем углу.
/// Содержит: организации, печать/подпись, расчётные счета, тему оформления.
struct SettingsView: View {
    @Environment(AppRouter.self) private var router
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                orgCard.appear(0)
                section(title: "Организация", items: [
                    .init(icon: "building.2", title: "Мои организации", route: .organizationForm),
                    .init(icon: "signature", title: "Печать и подпись", route: .signingCredentials),
                ]).appear(1)
                section(title: "Финансы", items: [
                    .init(icon: "creditcard", title: "Расчётные счета", route: .bankAccounts),
                ]).appear(2)
                section(title: "Оформление", items: [
                    .init(icon: "paintpalette", title: "Тема", route: .appearance),
                ]).appear(3)
                signOutButton.appear(4)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 40)
        }
        .scrollIndicators(.hidden)
        .background(Palette.canvas)
        .navigationTitle("Настройки")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Готово") { dismiss() }.foregroundStyle(Palette.accentDeep)
            }
        }
    }

    private struct Item: Identifiable {
        let id = UUID()
        let icon: String
        let title: String
        let route: Route
    }

    private var orgCard: some View {
        HStack(spacing: 14) {
            Text("ТР")
                .font(.system(size: 20, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .frame(width: 52, height: 52)
                .background(
                    LinearGradient(colors: [Palette.accent, Palette.accentDeep],
                                   startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                )
            VStack(alignment: .leading, spacing: 3) {
                Text("ООО «Тихая роскошь»").font(Typo.headline).foregroundStyle(Palette.ink)
                Text("ИНН 7707083893 · ОСНО").font(Typo.caption).foregroundStyle(Palette.inkSoft)
            }
            Spacer()
        }
        .luxuryCard(padding: 16)
    }

    private func section(title: String, items: [Item]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased())
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Palette.muted)
                .padding(.leading, 4)
            VStack(spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.element.id) { idx, item in
                    NavigationLink(value: item.route) {
                        HStack(spacing: 14) {
                            Image(systemName: item.icon)
                                .foregroundStyle(Palette.accentDeep)
                                .frame(width: 24)
                            Text(item.title).font(Typo.body).foregroundStyle(Palette.ink)
                            Spacer()
                            Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.muted)
                        }
                        .padding(.horizontal, 18).padding(.vertical, 15)
                    }
                    .buttonStyle(.pressable)
                    if idx < items.count - 1 {
                        Rectangle().fill(Palette.hairline).frame(height: 1).padding(.leading, 56)
                    }
                }
            }
            .luxuryCard(padding: 0)
        }
    }

    private var signOutButton: some View {
        Button {
            dismiss()
            router.signOut()
        } label: {
            Text("Выйти из аккаунта")
                .font(Typo.headline).foregroundStyle(Palette.negative)
                .frame(maxWidth: .infinity).padding(.vertical, 16)
                .background(Palette.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(LinearGradient(colors: [.white.opacity(0.85), Palette.hairline.opacity(0.5), Palette.hairline.opacity(0.2)], startPoint: .top, endPoint: .bottom), lineWidth: 1))
        }
        .buttonStyle(.pressable)
        .padding(.top, 8)
    }
}
