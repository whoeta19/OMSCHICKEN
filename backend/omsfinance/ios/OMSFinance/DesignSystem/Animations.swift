import SwiftUI

// MARK: - Единые анимационные токены

enum Motion {
    /// Базовый мягкий spring для переходов и появлений.
    static let soft = Animation.spring(response: 0.45, dampingFraction: 0.82)
    /// Более резкий spring для нажатий.
    static let snappy = Animation.spring(response: 0.30, dampingFraction: 0.7)
    /// Плавное затухание.
    static let fade = Animation.easeInOut(duration: 0.28)
}

// MARK: - Появление элементов (fade + slide + scale)

struct AppearTransition: ViewModifier {
    let index: Int
    @State private var shown = false

    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown ? 0 : 14)
            .scaleEffect(shown ? 1 : 0.98, anchor: .top)
            .onAppear {
                withAnimation(Motion.soft.delay(Double(index) * 0.06)) {
                    shown = true
                }
            }
    }
}

extension View {
    /// Каскадное появление списка карточек.
    func appear(_ index: Int = 0) -> some View {
        modifier(AppearTransition(index: index))
    }
}

// MARK: - Press-эффект для кнопок

struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .opacity(configuration.isPressed ? 0.9 : 1)
            .animation(Motion.snappy, value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == PressableStyle {
    static var pressable: PressableStyle { PressableStyle() }
}

// MARK: - Индикатор загрузки в стиле «тихой роскоши»

struct PulseLoader: View {
    @State private var animating = false
    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<3, id: \.self) { i in
                Circle()
                    .fill(Palette.accent)
                    .frame(width: 8, height: 8)
                    .scaleEffect(animating ? 1 : 0.5)
                    .opacity(animating ? 1 : 0.4)
                    .animation(
                        .easeInOut(duration: 0.6)
                            .repeatForever()
                            .delay(Double(i) * 0.15),
                        value: animating
                    )
            }
        }
        .onAppear { animating = true }
    }
}
