import SwiftUI

/// Настройки оформления. По ТЗ основной режим — светлый «тихая роскошь».
/// Тёмная тема обозначена как «скоро» — приложение спроектировано вокруг глубокого белого.
struct AppearanceView: View {
    @State private var selected: ThemeMode = .light
    @State private var accentIndex = 0

    enum ThemeMode: String, CaseIterable {
        case light = "Светлая"
        case system = "Системная"
        case dark = "Тёмная"
    }

    private let accents: [(String, Color)] = [
        ("Глубокий океан", Palette.accent),
        ("Полночь", Color(hex: 0x1E3A5F)),
        ("Шторм", Color(hex: 0x4A7FB5)),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                preview.appear(0)
                themeSection.appear(1)
                accentSection.appear(2)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 120)
        }
        .scrollIndicators(.hidden)
        .background(Palette.canvas)
        .navigationTitle("Тема")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var preview: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Предпросмотр").font(Typo.caption).foregroundStyle(Palette.inkSoft)
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.canvas)
                    .frame(width: 44, height: 44)
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(LinearGradient(colors: [.white.opacity(0.85), Palette.hairline.opacity(0.5), Palette.hairline.opacity(0.2)], startPoint: .top, endPoint: .bottom), lineWidth: 1))
                VStack(alignment: .leading, spacing: 6) {
                    RoundedRectangle(cornerRadius: 4).fill(Palette.ink.opacity(0.8)).frame(width: 120, height: 10)
                    RoundedRectangle(cornerRadius: 4).fill(accents[accentIndex].1).frame(width: 80, height: 10)
                }
                Spacer()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .luxuryCard()
    }

    private var themeSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Режим").font(Typo.headline).foregroundStyle(Palette.ink)
            VStack(spacing: 0) {
                ForEach(Array(ThemeMode.allCases.enumerated()), id: \.element) { idx, mode in
                    Button { withAnimation(Motion.snappy) { selected = mode } } label: {
                        HStack {
                            Text(mode.rawValue).font(Typo.body).foregroundStyle(Palette.ink)
                            if mode == .dark {
                                Text("скоро").font(Typo.caption).foregroundStyle(Palette.muted)
                                    .padding(.horizontal, 8).padding(.vertical, 3)
                                    .background(Palette.hairline, in: Capsule())
                            }
                            Spacer()
                            if selected == mode {
                                Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.accentDeep)
                            } else {
                                Circle().strokeBorder(Palette.muted, lineWidth: 1.5).frame(width: 22, height: 22)
                            }
                        }
                        .padding(.horizontal, 18).padding(.vertical, 15)
                    }
                    .buttonStyle(.pressable)
                    .disabled(mode == .dark)
                    if idx < ThemeMode.allCases.count - 1 {
                        Rectangle().fill(Palette.hairline).frame(height: 1).padding(.leading, 18)
                    }
                }
            }
            .luxuryCard(padding: 0)
        }
    }

    private var accentSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Акцент").font(Typo.headline).foregroundStyle(Palette.ink)
            VStack(spacing: 0) {
                ForEach(Array(accents.enumerated()), id: \.offset) { idx, accent in
                    Button { withAnimation(Motion.snappy) { accentIndex = idx } } label: {
                        HStack {
                            Circle().fill(accent.1).frame(width: 24, height: 24)
                            Text(accent.0).font(Typo.body).foregroundStyle(Palette.ink)
                            Spacer()
                            if accentIndex == idx {
                                Image(systemName: "checkmark").font(.system(size: 14, weight: .bold)).foregroundStyle(Palette.accentDeep)
                            }
                        }
                        .padding(.horizontal, 18).padding(.vertical, 14)
                    }
                    .buttonStyle(.pressable)
                    if idx < accents.count - 1 {
                        Rectangle().fill(Palette.hairline).frame(height: 1).padding(.leading, 56)
                    }
                }
            }
            .luxuryCard(padding: 0)
        }
    }
}
