import SwiftUI

// MARK: - ViewModel

@MainActor
@Observable
final class AssistantViewModel {
    var messages: [ChatMessage] = []
    var input: String = ""
    var isThinking = false
    var threadId: String?

    /// Текущее состояние сбора полей.
    var fields: DocumentFields?
    /// Готовый черновик (когда ready = true).
    var draft: DocumentDraft?

    /// Человекочитаемые названия полей.
    static let fieldLabels: [String: String] = [
        "type": "Тип документа",
        "counterpartyName": "Контрагент",
        "counterpartyInn": "ИНН контрагента",
        "items": "Позиции (товар, кол-во, цена, НДС)",
        "issueDate": "Дата документа",
    ]

    func start() async {
        guard messages.isEmpty else { return }
        messages = [
            .init(id: "sys", role: "ASSISTANT",
                  content: "Здравствуйте! Я помогу составить документ по форматам ФНС.\n\nМожете написать всё сразу, например:\n«УПД для ООО Ромашка ИНН 7707123456, консалтинг 2 часа по 25 000 руб, НДС 20%»\n\nИли указывайте данные по частям — я подскажу, чего не хватает.")
        ]
    }

    func send() async {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        input = ""

        withAnimation(Motion.soft) {
            messages.append(.init(id: UUID().uuidString, role: "USER", content: text))
            isThinking = true
        }

        do {
            // Создаём тред при первом сообщении.
            if threadId == nil {
                struct ThreadResp: Decodable { let id: String }
                let t: ThreadResp = try await APIClient.shared.post("/assistant/threads", body: EmptyBody())
                threadId = t.id
            }

            struct MsgBody: Encodable { let content: String }
            let resp: AssistantResponse = try await APIClient.shared.post(
                "/assistant/threads/\(threadId!)/messages",
                body: MsgBody(content: text)
            )

            await MainActor.run {
                withAnimation(Motion.soft) {
                    isThinking = false
                    messages.append(resp.message)
                    fields = resp.fields
                    if let d = resp.draft { draft = d }
                }
            }
        } catch {
            // Фоллбэк без сервера — демо-ответ.
            await demoResponse(for: text)
        }
    }

    /// Локальный парсинг для работы без backend.
    private func demoResponse(for text: String) async {
        try? await Task.sleep(for: .milliseconds(800))
        let lower = text.lowercased()

        // Простейший локальный парсинг для демо.
        var collected = fields?.collected ?? .init(
            type: nil, counterpartyName: nil, counterpartyInn: nil, items: nil, issueDate: nil
        )

        var newType = collected.type
        var newName = collected.counterpartyName
        var newInn = collected.counterpartyInn
        var newItems = collected.items
        var newDate = collected.issueDate

        if lower.contains("упд") { newType = "UPD" }
        else if lower.contains("счёт-факт") || lower.contains("счет-факт") { newType = "INVOICE" }
        else if lower.contains("акт") { newType = "ACT" }
        else if lower.contains("торг") { newType = "TORG12" }
        else if lower.contains("счёт") || lower.contains("счет") { newType = "BILL" }

        // ИНН.
        let innPattern = /\b(\d{10}|\d{12})\b/
        if let m = lower.firstMatch(of: innPattern) { newInn = String(m.1) }

        // Контрагент (после "для" или "ООО/ИП").
        let orgPattern = /(?:для\s+|)(ООО\s*«[^»]+»|ООО\s*"[^"]+"|ООО\s+\S+|ИП\s+\S+\s*\S*)/
        if let m = text.firstMatch(of: orgPattern) { newName = String(m.1) }

        let updCollected = DocumentFields.CollectedData(
            type: newType, counterpartyName: newName, counterpartyInn: newInn,
            items: newItems, issueDate: newDate
        )

        var missing: [String] = []
        if newType == nil { missing.append("type") }
        if newName == nil { missing.append("counterpartyName") }
        if newInn == nil { missing.append("counterpartyInn") }
        if newItems == nil || (newItems?.isEmpty ?? true) { missing.append("items") }

        let ready = missing.isEmpty
        let newFields = DocumentFields(collected: updCollected, missing: missing, ready: ready)

        var reply = ""
        if missing.isEmpty {
            reply = "Все данные собраны. Формирую документ."
        } else {
            let filled = Self.fieldLabels.filter { !missing.contains($0.key) && hasValue(updCollected, $0.key) }
            let needed = missing.compactMap { Self.fieldLabels[$0] }

            if !filled.isEmpty {
                reply += "Принял:\n" + filled.values.map { "✓ \($0)" }.joined(separator: "\n")
            }
            reply += "\n\nЕщё нужно:\n" + needed.map { "• \($0)" }.joined(separator: "\n")
            reply += "\n\nНапишите данные в любом удобном формате."
        }

        await MainActor.run {
            withAnimation(Motion.soft) {
                isThinking = false
                messages.append(.init(id: UUID().uuidString, role: "ASSISTANT", content: reply.trimmingCharacters(in: .whitespacesAndNewlines)))
                fields = newFields
            }
        }
    }

    private func hasValue(_ c: DocumentFields.CollectedData, _ key: String) -> Bool {
        switch key {
        case "type": return c.type != nil
        case "counterpartyName": return c.counterpartyName != nil
        case "counterpartyInn": return c.counterpartyInn != nil
        case "items": return !(c.items?.isEmpty ?? true)
        case "issueDate": return c.issueDate != nil
        default: return false
        }
    }
}

private struct EmptyBody: Encodable {}

// MARK: - View

struct CreateView: View {
    @Environment(AppRouter.self) private var router
    @State private var vm = AssistantViewModel()
    @FocusState private var focused: Bool

    private let quickActions: [(String, String, String)] = [
        ("УПД", "doc.richtext", "Составь УПД"),
        ("Счёт", "doc.plaintext", "Составь счёт на оплату"),
        ("Акт", "checkmark.seal", "Составь акт выполненных работ"),
        ("Счёт-фактура", "doc.text", "Составь счёт-фактуру"),
    ]

    var body: some View {
        VStack(spacing: 0) {
            header
            chatScroll
            if let f = vm.fields { fieldsCard(f) }
            if vm.messages.count <= 1 { quickActionStrip }
            inputBar
        }
        .background(Palette.canvas)
        .task { await vm.start() }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Создать").font(Typo.title).foregroundStyle(Palette.ink)
                HStack(spacing: 5) {
                    Circle().fill(Palette.positive).frame(width: 7, height: 7)
                    Text("Ассистент на связи").font(Typo.caption).foregroundStyle(Palette.inkSoft)
                }
            }
            Spacer()
        }
        .padding(.horizontal, 20)
        .padding(.top, 10).padding(.bottom, 6)
    }

    // MARK: - Chat scroll

    private var chatScroll: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 12) {
                    ForEach(vm.messages) { msg in
                        bubble(msg).id(msg.id)
                    }
                    if vm.isThinking { thinkingBubble.id("thinking") }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
            }
            .scrollIndicators(.hidden)
            .onChange(of: vm.messages.count) {
                withAnimation(Motion.soft) {
                    proxy.scrollTo(vm.messages.last?.id ?? "thinking", anchor: .bottom)
                }
            }
        }
    }

    private func bubble(_ msg: ChatMessage) -> some View {
        let isUser = msg.role == "USER"
        return HStack {
            if isUser { Spacer(minLength: 40) }
            Text(msg.content)
                .font(Typo.body)
                .foregroundStyle(isUser ? .white : Palette.ink)
                .padding(.horizontal, 16).padding(.vertical, 12)
                .background {
                    if isUser {
                        LinearGradient(colors: [Palette.accent, Palette.accentDeep],
                                       startPoint: .topLeading, endPoint: .bottomTrailing)
                    } else {
                        Palette.surface
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .strokeBorder(isUser ? .clear : LinearGradient(colors: [.white.opacity(0.85), Palette.hairline.opacity(0.5), Palette.hairline.opacity(0.2)], startPoint: .top, endPoint: .bottom), lineWidth: 1)
                )
            if !isUser { Spacer(minLength: 40) }
        }
        .transition(.asymmetric(
            insertion: .scale(scale: 0.92, anchor: isUser ? .bottomTrailing : .bottomLeading).combined(with: .opacity),
            removal: .opacity
        ))
    }

    private var thinkingBubble: some View {
        HStack {
            PulseLoader()
                .padding(.horizontal, 16).padding(.vertical, 14)
                .background(Palette.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(LinearGradient(colors: [.white.opacity(0.85), Palette.hairline.opacity(0.5), Palette.hairline.opacity(0.2)], startPoint: .top, endPoint: .bottom), lineWidth: 1))
            Spacer()
        }
    }

    // MARK: - Fields status card

    private func fieldsCard(_ f: DocumentFields) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: f.ready ? "checkmark.seal.fill" : "list.bullet.clipboard")
                    .foregroundStyle(f.ready ? Palette.positive : Palette.accent)
                Text(f.ready ? "Данные собраны" : "Сбор данных")
                    .font(Typo.headline).foregroundStyle(Palette.ink)
                Spacer()
                Text("\(5 - f.missing.count)/5")
                    .font(Typo.mono).foregroundStyle(Palette.inkSoft)
            }

            // Прогресс-бар
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 4).fill(Palette.hairline).frame(height: 6)
                    RoundedRectangle(cornerRadius: 4)
                        .fill(
                            LinearGradient(colors: [Palette.accent, Palette.accentDeep],
                                           startPoint: .leading, endPoint: .trailing)
                        )
                        .frame(width: geo.size.width * CGFloat(5 - f.missing.count) / 5.0, height: 6)
                        .animation(Motion.soft, value: f.missing.count)
                }
            }
            .frame(height: 6)

            // Заполненные поля — компактно
            let allKeys = ["type", "counterpartyName", "counterpartyInn", "items", "issueDate"]
            let filledKeys = allKeys.filter { !f.missing.contains($0) }
            let missingKeys = f.missing

            if !filledKeys.isEmpty {
                FlowText(items: filledKeys.compactMap { AssistantViewModel.fieldLabels[$0] }, filled: true)
            }
            if !missingKeys.isEmpty {
                FlowText(items: missingKeys.compactMap { AssistantViewModel.fieldLabels[$0] }, filled: false)
            }

            // Если есть черновик — кнопка открыть.
            if let draft = vm.draft, f.ready {
                Button {
                    router.push(.documentPreview(id: draft.number ?? "new"))
                } label: {
                    HStack {
                        Image(systemName: "doc.richtext").foregroundStyle(.white)
                        Text("Открыть документ")
                            .font(Typo.headline).foregroundStyle(.white)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 13)
                    .background(
                        LinearGradient(colors: [Palette.accent, Palette.accentDeep],
                                       startPoint: .leading, endPoint: .trailing),
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                    )
                }
                .buttonStyle(.pressable)
            }
        }
        .luxuryCard(padding: 16)
        .padding(.horizontal, 20)
        .padding(.vertical, 6)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    // MARK: - Quick actions

    private var quickActionStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(quickActions, id: \.0) { label, icon, prompt in
                    Button {
                        vm.input = prompt
                        Task { await vm.send() }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: icon).font(.system(size: 13))
                            Text(label).font(Typo.caption)
                        }
                        .foregroundStyle(Palette.ink)
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .background(Palette.surface, in: Capsule())
                        .overlay(Capsule().strokeBorder(LinearGradient(colors: [.white.opacity(0.85), Palette.hairline.opacity(0.5), Palette.hairline.opacity(0.2)], startPoint: .top, endPoint: .bottom), lineWidth: 1))
                    }
                    .buttonStyle(.pressable)
                }
            }
            .padding(.horizontal, 20)
        }
        .padding(.vertical, 6)
    }

    // MARK: - Input bar

    private var inputBar: some View {
        HStack(spacing: 10) {
            TextField("Данные документа…", text: $vm.input, axis: .vertical)
                .font(Typo.body)
                .focused($focused)
                .lineLimit(1...5)
                .padding(.horizontal, 16).padding(.vertical, 12)
                .background(Palette.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(LinearGradient(colors: [.white.opacity(0.85), Palette.hairline.opacity(0.5), Palette.hairline.opacity(0.2)], startPoint: .top, endPoint: .bottom), lineWidth: 1))

            Button { Task { await vm.send() } } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(
                        LinearGradient(colors: [Palette.accent, Palette.accentDeep],
                                       startPoint: .top, endPoint: .bottom),
                        in: Circle()
                    )
                    .opacity(vm.input.trimmingCharacters(in: .whitespaces).isEmpty ? 0.4 : 1)
            }
            .buttonStyle(.pressable)
            .disabled(vm.input.trimmingCharacters(in: .whitespaces).isEmpty || vm.isThinking)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .padding(.bottom, 78)
        .background(.ultraThinMaterial)
    }
}

// MARK: - Компактное отображение заполненных/пустых полей

private struct FlowText: View {
    let items: [String]
    let filled: Bool

    var body: some View {
        HStack(spacing: 0) {
            Image(systemName: filled ? "checkmark.circle.fill" : "circle.dashed")
                .font(.system(size: 13))
                .foregroundStyle(filled ? Palette.positive : Palette.muted)
                .padding(.trailing, 8)
            Text(items.joined(separator: " · "))
                .font(Typo.caption)
                .foregroundStyle(filled ? Palette.inkSoft : Palette.muted)
                .lineLimit(2)
        }
    }
}
