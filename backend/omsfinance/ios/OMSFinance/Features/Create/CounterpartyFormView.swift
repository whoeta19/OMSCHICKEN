import SwiftUI

/// Форма добавления контрагента. ИНН подтягивает реквизиты (заглушка под интеграцию с ФНС/ЕГРЮЛ).
struct CounterpartyFormView: View {
    @Environment(AppRouter.self) private var router
    @State private var inn = ""
    @State private var name = ""
    @State private var kpp = ""
    @State private var address = ""
    @State private var lookingUp = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                innCard.appear(0)
                detailsCard.appear(1)
                saveButton.appear(2)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 120)
        }
        .scrollIndicators(.hidden)
        .background(Palette.canvas)
        .navigationTitle("Новый контрагент")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var innCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("ИНН").font(Typo.caption).foregroundStyle(Palette.inkSoft)
            HStack(spacing: 10) {
                TextField("10 или 12 цифр", text: $inn)
                    .font(Typo.body)
                    .keyboardType(.numberPad)
                Button {
                    Task { await lookup() }
                } label: {
                    if lookingUp { PulseLoader() }
                    else { Text("Найти").font(Typo.headline).foregroundStyle(Palette.accentDeep) }
                }
                .disabled(inn.count < 10)
            }
            Text("Реквизиты подтянутся из ЕГРЮЛ/ЕГРИП автоматически")
                .font(Typo.caption).foregroundStyle(Palette.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .luxuryCard()
    }

    private var detailsCard: some View {
        VStack(spacing: 0) {
            field("Наименование", text: $name)
            divider
            field("КПП", text: $kpp)
            divider
            field("Адрес", text: $address)
        }
        .luxuryCard(padding: 0)
    }

    private func field(_ title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(Typo.caption).foregroundStyle(Palette.inkSoft)
            TextField("—", text: text).font(Typo.body).foregroundStyle(Palette.ink)
        }
        .padding(.horizontal, 20).padding(.vertical, 14)
    }

    private var divider: some View {
        Rectangle().fill(Palette.hairline).frame(height: 1).padding(.horizontal, 20)
    }

    private var saveButton: some View {
        Button { router.pop() } label: {
            Text("Сохранить контрагента")
                .font(Typo.headline).foregroundStyle(.white)
                .frame(maxWidth: .infinity).padding(.vertical, 16)
                .background(
                    LinearGradient(colors: [Palette.accent, Palette.accentDeep],
                                   startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 18, style: .continuous)
                )
                .opacity(name.isEmpty ? 0.5 : 1)
        }
        .buttonStyle(.pressable)
        .disabled(name.isEmpty)
    }

    private func lookup() async {
        withAnimation(Motion.fade) { lookingUp = true }
        try? await Task.sleep(for: .milliseconds(900))
        await MainActor.run {
            withAnimation(Motion.soft) {
                name = "ООО «Поставка»"
                kpp = "770701001"
                address = "г. Москва, ул. Тверская, 7"
                lookingUp = false
            }
        }
    }
}
