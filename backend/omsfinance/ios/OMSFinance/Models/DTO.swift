import Foundation

// MARK: - DTO, общие для нескольких экранов

struct TaskItem: Identifiable, Decodable, Hashable {
    let id: String
    let kind: String       // TAX / REPORT / NAVIGATION
    let status: String
    let title: String
    let subtitle: String?
    let amount: String?
    let dueDate: String?
    let deeplink: String?
}

struct TaskSummary: Decodable {
    let total: Int
    let overdue: Int
    let dueAmount: Double
}

struct TaxOverview: Decodable {
    let ensBalance: String
    let vatToPay: String
    let vatOutgoing: String
    let vatIncoming: String
    let vatDeductible: String
    let pendingDeductions: [PendingDeduction]

    struct PendingDeduction: Identifiable, Decodable, Hashable {
        var id: String { documentId }
        let documentId: String
        let number: String
        let counterparty: String?
        let vatAmount: String
    }
}

struct DocumentDTO: Identifiable, Decodable, Hashable {
    let id: String
    let type: String
    let status: String
    let number: String
    let issueDate: String
    let amountTotal: String
    let counterparty: Counterparty?

    struct Counterparty: Decodable, Hashable {
        let name: String
        let inn: String
    }
}

struct ChatMessage: Identifiable, Decodable, Hashable {
    let id: String
    let role: String   // USER / ASSISTANT
    let content: String
}

/// Блок собранных полей из ответа ассистента.
struct DocumentFields: Decodable, Hashable {
    let collected: CollectedData
    let missing: [String]
    let ready: Bool

    struct CollectedData: Decodable, Hashable {
        let type: String?
        let counterpartyName: String?
        let counterpartyInn: String?
        let items: [DocumentItem]?
        let issueDate: String?
    }

    struct DocumentItem: Decodable, Hashable, Identifiable {
        var id: String { name + String(quantity) }
        let name: String
        let quantity: Double
        let unit: String?
        let price: Double
        let vatRate: Double
        let vatAmount: Double?
        let total: Double?
    }
}

/// Готовый черновик документа.
struct DocumentDraft: Decodable, Hashable {
    let type: String
    let number: String?
    let issueDate: String?
    let counterpartyName: String?
    let counterpartyInn: String?
    let totalNet: Double?
    let totalVat: Double?
    let totalGross: Double?
}

/// Ответ сервера на отправку сообщения ассистенту.
struct AssistantResponse: Decodable {
    let message: ChatMessage
    let fields: DocumentFields?
    let draft: DocumentDraft?
}

struct FnsMessageDTO: Identifiable, Decodable, Hashable {
    let id: String
    let kind: String
    let subject: String
    let isRead: Bool
    let dueDate: String?
}

struct ReportDTO: Identifiable, Decodable, Hashable {
    let id: String
    let destination: String  // FNS / SFR / PFR / EFS
    let title: String
    let period: String
    let status: String
}
