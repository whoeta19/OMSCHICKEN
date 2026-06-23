import SwiftUI

/// Единая точка маппинга `Route` → экран. Все NavigationStack используют
/// её через `.navigationDestination(for: Route.self)`. Добавление нового
/// экрана = одна ветка здесь + один case в `Route`.
struct DestinationView: View {
    let route: Route
    @Environment(AppRouter.self) private var router

    var body: some View {
        switch route {
        // Задачи
        case .taskDetail(let id):
            TaskDetailView(taskId: id)

        // Налог
        case .vatBreakdown(let period):
            VatBreakdownView(period: period)
        case .deductionGaps:
            DeductionGapsView()

        // Создать
        case .assistantThread(let id):
            AssistantChatView(threadId: id)
        case .documentPreview(let id):
            DocumentPreviewView(documentId: id)
        case .counterpartyForm:
            CounterpartyFormView()

        // Документы
        case .documentDetail(let id):
            DocumentDetailView(documentId: id)

        // ФНС
        case .fnsMessage(let id):
            FnsMessageView(messageId: id)
        case .reportDetail(let id):
            ReportDetailView(reportId: id)

        // Настройки
        case .settings:
            SettingsView()
        case .organizationForm:
            OrganizationFormView()
        case .bankAccounts:
            BankAccountsView()
        case .appearance:
            AppearanceView()
        case .signingCredentials:
            SigningCredentialsView()
        }
    }
}
