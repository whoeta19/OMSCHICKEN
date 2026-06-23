import SwiftUI

struct OnboardingView: View {
    @Environment(AppRouter.self) private var router
    @State private var appeared = false
    @State private var loadingProvider: String?

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Логотип / монограмма
            ZStack {
                Circle()
                    .fill(LinearGradient(colors: [Palette.accent, Palette.accentDeep],
                                         startPoint: .top, endPoint: .bottom))
                    .frame(width: 84, height: 84)
                    .shadow(color: Palette.accent.opacity(0.4), radius: 20, y: 10)
                Text("О")
                    .font(.system(size: 38, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
            }
            .scaleEffect(appeared ? 1 : 0.7)
            .opacity(appeared ? 1 : 0)

            VStack(spacing: 10) {
                Text("OMSFinance")
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .foregroundStyle(Palette.ink)
                Text("Тихая бухгалтерия\nдля вашего бизнеса")
                    .multilineTextAlignment(.center)
                    .font(Typo.body)
                    .foregroundStyle(Palette.inkSoft)
            }
            .padding(.top, 24)
            .opacity(appeared ? 1 : 0)
            .offset(y: appeared ? 0 : 12)

            Spacer()

            VStack(spacing: 12) {
                authButton(title: "Войти через Яндекс", icon: "y.circle.fill",
                           provider: "YANDEX", filled: true)
                authButton(title: "Войти через Apple", icon: "apple.logo",
                           provider: "APPLE", filled: false)
                authButton(title: "Войти по ЭЦП", icon: "signature",
                           provider: "ECP", filled: false)
            }
            .padding(.horizontal, 24)
            .opacity(appeared ? 1 : 0)
            .offset(y: appeared ? 0 : 24)

            Text("Регистрация — автоматически при первом входе")
                .font(Typo.caption)
                .foregroundStyle(Palette.muted)
                .padding(.top, 18)
                .padding(.bottom, 24)
                .opacity(appeared ? 1 : 0)
        }
        .onAppear { withAnimation(Motion.soft) { appeared = true } }
    }

    private func authButton(title: String, icon: String, provider: String, filled: Bool) -> some View {
        Button {
            authenticate(provider)
        } label: {
            HStack(spacing: 10) {
                if loadingProvider == provider {
                    PulseLoader()
                } else {
                    Image(systemName: icon).font(.system(size: 18, weight: .medium))
                    Text(title).font(Typo.headline)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 54)
            .foregroundStyle(filled ? .white : Palette.ink)
            .background(
                Group {
                    if filled {
                        LinearGradient(colors: [Palette.accent, Palette.accentDeep],
                                       startPoint: .leading, endPoint: .trailing)
                    } else {
                        Palette.surface
                    }
                },
                in: RoundedRectangle(cornerRadius: 16, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(filled ? Color.clear : LinearGradient(colors: [.white.opacity(0.85), Palette.hairline.opacity(0.5), Palette.hairline.opacity(0.2)], startPoint: .top, endPoint: .bottom), lineWidth: 1)
            )
        }
        .buttonStyle(.pressable)
        .disabled(loadingProvider != nil)
    }

    private func authenticate(_ provider: String) {
        loadingProvider = provider
        Task {
            // Тут запускается SDK провайдера (Яндекс OAuth, ASAuthorization, проверка ЭЦП),
            // затем POST /auth/login с верифицированным профилем.
            try? await Task.sleep(for: .milliseconds(900))
            await MainActor.run {
                loadingProvider = nil
                router.completeAuth()
            }
        }
    }
}
