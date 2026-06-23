import SwiftUI

/// Экран сохранённого треда ассистента с трекингом собранных полей.
struct AssistantChatView: View {
    let threadId: String
    @Environment(AppRouter.self) private var router
    @State private var messages: [ChatMessage] = []
    @State private var input = ""
    @State private var isThinking = false
    @State private var fields: DocumentFields?
    @State private var draft: DocumentDraft?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            chatScroll
            if let f = fields { fieldsCard(f) }
            inputBar
        }
        .background(Palette.canvas)
        .navigationTitle("Диалог")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private var chatScroll: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 12) {
                    ForEach(messages) { msg in
                        bubble(msg).id(msg.id)
                    }
                    if isThinking { thinkingBubble.id("thinking") }
                }
                .padding(.horizontal, 20).padding(.vertical, 16)
            }
            .scrollIndicators(.hidden)
            .onChange(of: messages.count) {
                withAnimation(Motion.soft) { proxy.scrollTo(messages.last?.id, anchor: .bottom) }
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
                    } else { Palette.surface }
                }
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(isUser ? .clear : LinearGradient(colors: [.white.opacity(0.85), Palette.hairline.opacity(0.5), Palette.hairline.opacity(0.2)], startPoint: .top, endPoint: .bottom), lineWidth: 1))
            if !isUser { Spacer(minLength: 40) }
        }
        .transition(.asymmetric(
            insertion: .scale(scale: 0.92, anchor: isUser ? .bottomTrailing : .bottomLeading).combined(with: .opacity),
            removal: .opacity))
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
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 4).fill(Palette.hairline).frame(height: 6)
                    RoundedRectangle(cornerRadius: 4)
                        .fill(LinearGradient(colors: [Palette.accent, Palette.accentDeep], startPoint: .leading, endPoint: .trailing))
                        .frame(width: geo.size.width * CGFloat(5 - f.missing.count) / 5.0, height: 6)
                        .animation(Motion.soft, value: f.missing.count)
                }
            }
            .frame(height: 6)

            if f.ready, let d = draft {
                Button { router.push(.documentPreview(id: d.number ?? "new")) } label: {
                    HStack {
                        Image(systemName: "doc.richtext").foregroundStyle(.white)
                        Text("Открыть документ").font(Typo.headline).foregroundStyle(.white)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 13)
                    .background(
                        LinearGradient(colors: [Palette.accent, Palette.accentDeep], startPoint: .leading, endPoint: .trailing),
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
                .buttonStyle(.pressable)
            }
        }
        .luxuryCard(padding: 16)
        .padding(.horizontal, 20).padding(.vertical, 6)
    }

    private var inputBar: some View {
        HStack(spacing: 10) {
            TextField("Данные документа…", text: $input, axis: .vertical)
                .font(Typo.body).focused($focused)
                .padding(.horizontal, 16).padding(.vertical, 12)
                .background(Palette.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(LinearGradient(colors: [.white.opacity(0.85), Palette.hairline.opacity(0.5), Palette.hairline.opacity(0.2)], startPoint: .top, endPoint: .bottom), lineWidth: 1))
            Button(action: send) {
                Image(systemName: "arrow.up")
                    .font(.system(size: 18, weight: .bold)).foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(
                        LinearGradient(colors: [Palette.accent, Palette.accentDeep], startPoint: .top, endPoint: .bottom),
                        in: Circle())
                    .opacity(input.trimmingCharacters(in: .whitespaces).isEmpty ? 0.4 : 1)
            }
            .buttonStyle(.pressable)
            .disabled(input.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(.ultraThinMaterial)
    }

    private func send() {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        input = ""
        withAnimation(Motion.soft) {
            messages.append(.init(id: UUID().uuidString, role: "USER", content: text))
            isThinking = true
        }
        Task {
            do {
                struct MsgBody: Encodable { let content: String }
                let resp: AssistantResponse = try await APIClient.shared.post(
                    "/assistant/threads/\(threadId)/messages", body: MsgBody(content: text))
                await MainActor.run {
                    withAnimation(Motion.soft) {
                        isThinking = false
                        messages.append(resp.message)
                        fields = resp.fields
                        if let d = resp.draft { draft = d }
                    }
                }
            } catch {
                await MainActor.run {
                    withAnimation(Motion.soft) {
                        isThinking = false
                        messages.append(.init(id: UUID().uuidString, role: "ASSISTANT",
                                              content: "Не удалось связаться с сервером. Попробуйте ещё раз."))
                    }
                }
            }
        }
    }

    private func load() async {
        messages = (try? await APIClient.shared.get("/assistant/threads/\(threadId)")) ?? [
            .init(id: "1", role: "ASSISTANT", content: "Продолжаем составление документа. Напишите недостающие данные.")
        ]
    }
}
