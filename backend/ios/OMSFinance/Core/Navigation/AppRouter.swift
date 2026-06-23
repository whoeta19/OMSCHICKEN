import SwiftUI
import Observation

/// Центральный роутер приложения. Хранит выбранную вкладку, независимые
/// стеки навигации для каждой вкладки, состояние модальных экранов и фазу авторизации.
@Observable
@MainActor
final class AppRouter {

    enum Phase {
        case onboarding   // приветствие + вход
        case main         // основной TabView
    }

    var phase: Phase = .onboarding
    var selectedTab: Tab = .tasks

    /// Отдельный путь навигации для каждой вкладки — стандарт для TabView,
    /// чтобы стеки не «перемешивались» при переключении.
    var paths: [Tab: [Route]] = [:]

    /// Модальные представления (настройки и т.п.).
    var presentedSheet: Route?

    // MARK: - Управление вкладками

    func select(_ tab: Tab) {
        // Повторный тап по активной вкладке — pop to root.
        if selectedTab == tab {
            paths[tab] = []
        } else {
            withAnimation(Motion.soft) { selectedTab = tab }
        }
    }

    // MARK: - Push / Pop

    func push(_ route: Route, on tab: Tab? = nil) {
        let target = tab ?? selectedTab
        paths[target, default: []].append(route)
    }

    func pop(on tab: Tab? = nil) {
        let target = tab ?? selectedTab
        _ = paths[target]?.popLast()
    }

    func popToRoot(on tab: Tab? = nil) {
        let target = tab ?? selectedTab
        paths[target] = []
    }

    /// Привязка пути для конкретной вкладки (передаётся в NavigationStack).
    func binding(for tab: Tab) -> Binding<[Route]> {
        Binding(
            get: { self.paths[tab, default: []] },
            set: { self.paths[tab] = $0 }
        )
    }

    // MARK: - Модальные экраны

    func present(_ route: Route) {
        presentedSheet = route
    }

    // MARK: - Deeplinks (например, из навигационных задач: "create/new")

    func handleDeeplink(_ deeplink: String) {
        let parts = deeplink.split(separator: "/").map(String.init)
        guard let first = parts.first else { return }
        switch first {
        case "create":
            select(.create)
        case "tax":
            select(.tax)
            if parts.count > 1 { push(.vatBreakdown(period: parts[1]), on: .tax) }
        case "documents":
            select(.documents)
            if parts.count > 1 { push(.documentDetail(id: parts[1]), on: .documents) }
        default:
            break
        }
    }

    // MARK: - Авторизация

    func completeAuth() {
        withAnimation(Motion.soft) { phase = .main }
    }

    func signOut() {
        withAnimation(Motion.fade) {
            phase = .onboarding
            paths = [:]
            selectedTab = .tasks
        }
    }
}
