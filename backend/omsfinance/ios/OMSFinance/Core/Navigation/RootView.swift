import SwiftUI

// MARK: - Корневой контейнер: онбординг ↔ основной интерфейс

struct RootView: View {
    @State private var router = AppRouter()

    var body: some View {
        ZStack {
            Palette.canvas.ignoresSafeArea()

            switch router.phase {
            case .onboarding:
                OnboardingView()
                    .transition(.opacity.combined(with: .scale(scale: 1.02)))
            case .main:
                MainScaffold()
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        }
        .environment(router)
        .animation(Motion.soft, value: router.phase)
    }
}

// MARK: - Основной каркас: контент вкладок + кастомный таб-бар + шестерёнка

struct MainScaffold: View {
    @Environment(AppRouter.self) private var router
    @Namespace private var tabNamespace

    var body: some View {
        @Bindable var router = router

        ZStack(alignment: .bottom) {
            // Контент активной вкладки в собственном NavigationStack
            tabContent
                .ignoresSafeArea(.keyboard)

            CustomTabBar(namespace: tabNamespace)
                .padding(.horizontal, 14)
                .padding(.bottom, 4)
        }
        .overlay(alignment: .topTrailing) { settingsGear }
        .sheet(item: Binding(
            get: { router.presentedSheet.map(SheetRoute.init) },
            set: { router.presentedSheet = $0?.route }
        )) { sheet in
            NavigationStack {
                DestinationView(route: sheet.route)
                    .environment(router)
                    .navigationDestination(for: Route.self) { route in
                        DestinationView(route: route).environment(router)
                    }
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
    }

    @ViewBuilder
    private var tabContent: some View {
        @Bindable var router = router
        ForEach(Tab.allCases) { tab in
            NavigationStack(path: router.binding(for: tab)) {
                rootScreen(for: tab)
                    .navigationDestination(for: Route.self) { route in
                        DestinationView(route: route)
                    }
            }
            .opacity(router.selectedTab == tab ? 1 : 0)
            .allowsHitTesting(router.selectedTab == tab)
        }
    }

    @ViewBuilder
    private func rootScreen(for tab: Tab) -> some View {
        switch tab {
        case .tasks:     TasksView()
        case .tax:       TaxView()
        case .create:    CreateView()
        case .documents: DocumentsView()
        case .fns:       FnsView()
        }
    }

    // Шестерёнка настроек — крупная, ниже Dynamic Island.
    private var settingsGear: some View {
        Button {
            router.present(.settings)
        } label: {
            Image(systemName: "gearshape")
                .font(.system(size: 22, weight: .regular))
                .foregroundStyle(Palette.muted)
                .padding(14)
                .background {
                    ZStack {
                        Circle().fill(.ultraThinMaterial)
                        Circle().fill(Color.white.opacity(0.3))
                        Circle().stroke(
                            LinearGradient(
                                colors: [.white.opacity(0.6), .white.opacity(0.1)],
                                startPoint: .top, endPoint: .bottom
                            ),
                            lineWidth: 0.5
                        )
                    }
                }
                .shadow(color: Palette.ink.opacity(0.06), radius: 8, y: 3)
        }
        .buttonStyle(.pressable)
        .padding(.trailing, 18)
        .padding(.top, 56)
    }
}

private struct SheetRoute: Identifiable {
    let route: Route
    var id: String { String(describing: route) }
}

// MARK: - Liquid Glass таб-бар

struct CustomTabBar: View {
    @Environment(AppRouter.self) private var router
    var namespace: Namespace.ID

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Tab.allCases) { tab in
                if tab == .create {
                    centerButton
                } else {
                    tabButton(tab)
                }
            }
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 8)
        .background {
            // Liquid glass: глубокий blur + полупрозрачный белый + спекуляр сверху
            ZStack {
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .fill(.ultraThinMaterial)
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .fill(Color.white.opacity(0.35))
                // Внутренний блик сверху — имитация преломления света
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .stroke(
                        LinearGradient(
                            colors: [.white.opacity(0.8), .white.opacity(0.1), .clear],
                            startPoint: .top, endPoint: .bottom
                        ),
                        lineWidth: 1
                    )
            }
        }
        .shadow(color: Palette.ink.opacity(0.08), radius: 24, y: 10)
        .shadow(color: Palette.ink.opacity(0.04), radius: 4, y: 2)
    }

    private func tabButton(_ tab: Tab) -> some View {
        Button {
            withAnimation(Motion.snappy) { router.select(tab) }
        } label: {
            VStack(spacing: 3) {
                ZStack {
                    if router.selectedTab == tab {
                        // Стеклянная «пилюля» активного таба
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(Palette.accent.opacity(0.1))
                            .overlay(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .stroke(Palette.accent.opacity(0.15), lineWidth: 0.5)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .stroke(
                                        LinearGradient(
                                            colors: [.white.opacity(0.5), .clear],
                                            startPoint: .top, endPoint: .bottom
                                        ),
                                        lineWidth: 0.5
                                    )
                            )
                            .frame(width: 44, height: 36)
                            .matchedGeometryEffect(id: "tabHighlight", in: namespace)
                    }
                    Image(systemName: tab.systemImage)
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(router.selectedTab == tab ? Palette.accentDeep : Palette.muted)
                }
                .frame(height: 36)
                Text(tab.title)
                    .font(.system(size: 9, weight: router.selectedTab == tab ? .semibold : .medium))
                    .foregroundStyle(router.selectedTab == tab ? Palette.accentDeep : Palette.muted)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.pressable)
    }

    private var centerButton: some View {
        let shape = RoundedRectangle(cornerRadius: 18, style: .continuous)
        return Button {
            withAnimation(Motion.snappy) { router.select(.create) }
        } label: {
            VStack(spacing: 3) {
                ZStack {
                    shape
                        .fill(
                            LinearGradient(
                                colors: [Palette.accent.opacity(0.85), Palette.accentDeep.opacity(0.95)],
                                startPoint: .topLeading, endPoint: .bottomTrailing
                            )
                        )
                    // Спекулярный блик
                    shape
                        .stroke(
                            LinearGradient(
                                colors: [.white.opacity(0.45), .white.opacity(0.05)],
                                startPoint: .top, endPoint: .bottom
                            ),
                            lineWidth: 0.5
                        )
                    // Верхний блик-полумесяц
                    Ellipse()
                        .fill(.white.opacity(0.15))
                        .frame(width: 30, height: 10)
                        .offset(y: -10)
                        .blur(radius: 3)

                    Image(systemName: "plus")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(.white)
                }
                .frame(width: 48, height: 40)
                .shadow(color: Palette.accent.opacity(0.3), radius: 12, y: 4)

                Text(Tab.create.title)
                    .font(.system(size: 9, weight: router.selectedTab == .create ? .semibold : .medium))
                    .foregroundStyle(router.selectedTab == .create ? Palette.accentDeep : .white.opacity(0.9))
            }
            .scaleEffect(router.selectedTab == .create ? 1.04 : 1)
            .animation(Motion.snappy, value: router.selectedTab)
        }
        .buttonStyle(.pressable)
        .frame(maxWidth: .infinity)
        .offset(y: -6)
    }
}
