import Foundation

// MARK: - Вкладки TabView

enum Tab: Int, CaseIterable, Identifiable {
    case tasks      // Задачи
    case tax        // Налог
    case create     // Создать (по центру)
    case documents  // Документы
    case fns        // ФНС

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .tasks: "Задачи"
        case .tax: "Налог"
        case .create: "Создать"
        case .documents: "Документы"
        case .fns: "ФНС"
        }
    }

    var systemImage: String {
        switch self {
        case .tasks: "checklist"
        case .tax: "percent"
        case .create: "plus"
        case .documents: "doc.text"
        case .fns: "building.columns"
        }
    }
}

// MARK: - Единый тип маршрута для всех NavigationStack

/// Все пути приложения описаны одним значением. Это позволяет иметь
/// единственный `destinationView(for:)` и предсказуемую, тестируемую навигацию.
enum Route: Hashable {
    // Задачи
    case taskDetail(id: String)

    // Налог
    case vatBreakdown(period: String)
    case deductionGaps

    // Создать (чат-ассистент)
    case assistantThread(id: String)
    case documentPreview(id: String)
    case counterpartyForm

    // Документы
    case documentDetail(id: String)

    // ФНС
    case fnsMessage(id: String)
    case reportDetail(id: String)

    // Настройки
    case settings
    case organizationForm
    case bankAccounts
    case appearance
    case signingCredentials
}
