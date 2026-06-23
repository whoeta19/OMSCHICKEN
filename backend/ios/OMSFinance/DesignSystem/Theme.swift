import SwiftUI

// MARK: - Палитра «Тихая роскошь»
// Глубокий белый фон, глубокий океанский синий акцент, мягкие тёплые серые.

enum Palette {
    /// Глубокий, чуть тёплый белый — основа фона.
    static let canvas = Color(hex: 0xFBFAF8)
    /// Поверхности карточек — почти белый, на тон светлее фона воспринимается как «приподнятый».
    static let surface = Color(hex: 0xFFFFFF)
    /// Глубокий океанский синий — акцент.
    static let accent = Color(hex: 0x2B6CB0)
    /// Тёмный океан для нажатий/градиентов.
    static let accentDeep = Color(hex: 0x1A4A7A)
    /// Основной текст — тёплый графит, не чистый чёрный.
    static let ink = Color(hex: 0x1C1B19)
    /// Вторичный текст.
    static let inkSoft = Color(hex: 0x8A857C)
    /// Тонкие разделители.
    static let hairline = Color(hex: 0xEDEAE4)
    /// Блеклый цвет для второстепенных элементов (например, шестерёнка настроек).
    static let muted = Color(hex: 0xC7C2B8)

    static let positive = Color(hex: 0x4FAE84)
    static let negative = Color(hex: 0xD2694B)
}

// MARK: - Типографика

enum Typo {
    static func bigData(_ value: String) -> Text {
        Text(value)
            .font(.system(size: 44, weight: .bold, design: .rounded))
    }
    static let title = Font.system(size: 24, weight: .bold, design: .rounded)
    static let headline = Font.system(size: 17, weight: .semibold)
    static let body = Font.system(size: 16, weight: .medium)
    static let caption = Font.system(size: 13, weight: .medium)
    static let mono = Font.system(size: 14, weight: .semibold, design: .monospaced)
}

// MARK: - Карточка «тихой роскоши»

struct LuxuryCard: ViewModifier {
    var padding: CGFloat = 20
    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .overlay(
                // Liquid glass обводка: спекулярный градиент сверху вниз
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .stroke(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(0.85),
                                Palette.hairline.opacity(0.6),
                                Palette.hairline.opacity(0.3),
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        ),
                        lineWidth: 1
                    )
            )
            .shadow(color: Palette.ink.opacity(0.04), radius: 18, x: 0, y: 10)
    }
}

extension View {
    func luxuryCard(padding: CGFloat = 20) -> some View {
        modifier(LuxuryCard(padding: padding))
    }
}

// MARK: - Liquid Glass

/// Стеклянный эффект в духе Apple Vision: blur, полупрозрачность, спекулярный блик.
struct LiquidGlass: ViewModifier {
    var cornerRadius: CGFloat = 24
    func body(content: Content) -> some View {
        content
            .background {
                ZStack {
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .fill(.ultraThinMaterial)
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .fill(Color.white.opacity(0.35))
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .stroke(
                            LinearGradient(
                                colors: [.white.opacity(0.7), .white.opacity(0.1), .clear],
                                startPoint: .top, endPoint: .bottom
                            ),
                            lineWidth: 0.5
                        )
                }
            }
            .shadow(color: Palette.ink.opacity(0.08), radius: 20, y: 8)
    }
}

extension View {
    func liquidGlass(cornerRadius: CGFloat = 24) -> some View {
        modifier(LiquidGlass(cornerRadius: cornerRadius))
    }
}

/// Спекулярная обводка «liquid glass» — для любой фигуры.
/// Верх яркий (блик от света), к низу затухает.
struct GlassStroke<S: InsettableShape>: ViewModifier {
    let shape: S
    func body(content: Content) -> some View {
        content
            .overlay(
                shape.strokeBorder(
                    LinearGradient(
                        colors: [.white.opacity(0.85), Palette.hairline.opacity(0.5), Palette.hairline.opacity(0.2)],
                        startPoint: .top, endPoint: .bottom
                    ),
                    lineWidth: 1
                )
            )
    }
}

extension View {
    func glassStroke<S: InsettableShape>(_ shape: S) -> some View {
        modifier(GlassStroke(shape: shape))
    }
}

// MARK: - Helpers

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}
