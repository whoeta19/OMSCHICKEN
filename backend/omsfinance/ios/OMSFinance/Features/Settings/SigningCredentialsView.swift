import SwiftUI

/// Управление печатью организации и электронной подписью (ЭЦП).
/// Используются при формировании документов в предпросмотре.
struct SigningCredentialsView: View {
    @State private var hasStamp = true
    @State private var hasSignature = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                credentialCard(
                    icon: "seal",
                    title: "Печать организации",
                    subtitle: hasStamp ? "Загружена · PNG с прозрачным фоном" : "Не загружена",
                    active: hasStamp,
                    actionTitle: hasStamp ? "Заменить" : "Загрузить"
                ) { hasStamp = true }.appear(0)

                credentialCard(
                    icon: "signature",
                    title: "Электронная подпись",
                    subtitle: hasSignature ? "КЭП · действует до 14.09.2026" : "Не подключена",
                    active: hasSignature,
                    actionTitle: hasSignature ? "Обновить" : "Подключить ЭЦП"
                ) { hasSignature = true }.appear(1)

                note.appear(2)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 120)
        }
        .scrollIndicators(.hidden)
        .background(Palette.canvas)
        .navigationTitle("Печать и подпись")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func credentialCard(icon: String, title: String, subtitle: String, active: Bool, actionTitle: String, action: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 14) {
                Image(systemName: active ? "\(icon).fill" : icon)
                    .font(.system(size: 22))
                    .foregroundStyle(active ? Palette.positive : Palette.muted)
                    .frame(width: 48, height: 48)
                    .background((active ? Palette.positive : Palette.muted).opacity(0.12),
                               in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(Typo.headline).foregroundStyle(Palette.ink)
                    Text(subtitle).font(Typo.caption).foregroundStyle(Palette.inkSoft)
                }
                Spacer()
            }
            Button(action: action) {
                Text(actionTitle)
                    .font(Typo.headline).foregroundStyle(active ? Palette.ink : .white)
                    .frame(maxWidth: .infinity).padding(.vertical, 13)
                    .background {
                        if active {
                            Palette.surface
                        } else {
                            LinearGradient(colors: [Palette.accent, Palette.accentDeep],
                                           startPoint: .leading, endPoint: .trailing)
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(active ? LinearGradient(colors: [.white.opacity(0.85), Palette.hairline.opacity(0.5), Palette.hairline.opacity(0.2)], startPoint: .top, endPoint: .bottom) : LinearGradient(colors: [Color.clear], startPoint: .top, endPoint: .bottom), lineWidth: 1))
            }
            .buttonStyle(.pressable)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .luxuryCard()
    }

    private var note: some View {
        Text("Печать и подпись добавляются к документам автоматически при формировании в чате-ассистенте и в предпросмотре.")
            .font(Typo.caption).foregroundStyle(Palette.muted)
            .padding(.horizontal, 4)
    }
}
