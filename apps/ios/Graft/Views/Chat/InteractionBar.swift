import SwiftUI

/// Inline prompts the agent can raise mid-turn: tool approvals, clarifying
/// questions, and secret requests. Rendered between transcript and composer.
struct InteractionBar: View {
    let chat: ChatModel
    @State private var secretValue = ""

    var body: some View {
        VStack(spacing: 8) {
            if let approval = chat.pendingApproval {
                ApprovalPrompt(approval: approval, chat: chat)
            }
            if let clarify = chat.pendingClarify {
                ClarifyPrompt(clarify: clarify, chat: chat)
            }
            if let secret = chat.pendingSecret {
                SecretPrompt(secret: secret, chat: chat, value: $secretValue)
            }
        }
        .padding(.horizontal, 12)
    }
}

private struct ApprovalPrompt: View {
    let approval: ApprovalRequest
    let chat: ChatModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Approval needed", systemImage: "shield.lefthalf.filled")
                .font(.footnote.weight(.semibold))
            if !approval.command.isEmpty {
                Text(approval.command)
                    .font(.caption.monospaced())
                    .lineLimit(4)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.fill.quaternary, in: .rect(cornerRadius: 8))
            }
            if !approval.description.isEmpty {
                Text(approval.description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            HStack {
                Button("Deny", role: .destructive) {
                    Task { await chat.respondApproval(choice: "deny") }
                }
                Spacer()
                Button("Once") {
                    Task { await chat.respondApproval(choice: "once") }
                }
                Button("Session") {
                    Task { await chat.respondApproval(choice: "session") }
                }
                Button("Always") {
                    Task { await chat.respondApproval(choice: "always") }
                }
                .buttonStyle(.borderedProminent)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
        .padding(12)
        .background(Theme.surface, in: .rect(cornerRadius: 16))
    }
}

private struct ClarifyPrompt: View {
    let clarify: ClarifyRequest
    let chat: ChatModel
    @State private var customAnswer = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(clarify.question, systemImage: "questionmark.circle")
                .font(.footnote.weight(.medium))
            FlowButtons(choices: clarify.choices) { choice in
                Task { await chat.respondClarify(answer: choice) }
            }
            HStack {
                TextField("Custom answer", text: $customAnswer)
                    .textFieldStyle(.roundedBorder)
                    .font(.footnote)
                Button("Send") {
                    let answer = customAnswer.trimmingCharacters(in: .whitespaces)
                    guard !answer.isEmpty else { return }
                    customAnswer = ""
                    Task { await chat.respondClarify(answer: answer) }
                }
                .controlSize(.small)
            }
        }
        .padding(12)
        .background(Theme.surface, in: .rect(cornerRadius: 16))
    }
}

private struct FlowButtons: View {
    let choices: [String]
    let action: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack {
                ForEach(choices, id: \.self) { choice in
                    Button(choice) { action(choice) }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                }
            }
        }
    }
}

private struct SecretPrompt: View {
    let secret: SecretRequest
    let chat: ChatModel
    @Binding var value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(secret.prompt.isEmpty ? "Secret required (\(secret.envVar))" : secret.prompt,
                  systemImage: "key")
                .font(.footnote.weight(.medium))
            HStack {
                SecureField("Value", text: $value)
                    .textFieldStyle(.roundedBorder)
                    .font(.footnote)
                Button("Submit") {
                    let submitted = value
                    value = ""
                    Task { await chat.respondSecret(value: submitted) }
                }
                .controlSize(.small)
                .disabled(value.isEmpty)
            }
        }
        .padding(12)
        .background(Theme.surface, in: .rect(cornerRadius: 16))
    }
}
