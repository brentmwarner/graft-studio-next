import Foundation
import SwiftUI
import UniformTypeIdentifiers

/// Serializes a chat transcript to Markdown for export/share. MainActor because
/// it reads `TranscriptItem` (a @MainActor @Observable).
@MainActor
enum ConversationExport {
    /// Render the visible conversation as Markdown: user/assistant turns as
    /// labelled sections, tool/system lines as compact notes. Streaming/empty
    /// rows and delegation blocks are skipped.
    static func markdown(from items: [TranscriptItem]) -> String {
        var lines: [String] = []
        for item in items {
            if item.isStreaming { continue }
            switch item.kind {
            case .user:
                let text = item.text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { continue }
                lines.append("## You")
                lines.append("")
                lines.append(text)
            case .assistant:
                let text = item.text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { continue }
                lines.append("## Assistant")
                lines.append("")
                lines.append(text)
            case .tool:
                let name = item.toolName.isEmpty ? "tool" : item.toolName
                let detail = item.toolContext.trimmingCharacters(in: .whitespacesAndNewlines)
                lines.append("> tool · \(name)" + (detail.isEmpty ? "" : ": \(detail)"))
            case .system, .error:
                let text = item.text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { continue }
                lines.append("> \(text)")
            case .agents:
                continue
            }
            lines.append("")
        }
        let body = lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        return body.isEmpty ? "_(empty conversation)_\n" : body + "\n"
    }

    /// A shareable, file-named export for `ShareLink`.
    static func exported(from items: [TranscriptItem]) -> ExportedConversation {
        ExportedConversation(markdown: markdown(from: items), slug: slug(from: items))
    }

    private static func slug(from items: [TranscriptItem]) -> String {
        let firstUser = items.first(where: { $0.kind == .user })?.text ?? ""
        let words = firstUser
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
            .prefix(5)
            .joined(separator: "-")
            .lowercased()
        let capped = String(words.prefix(40))
        return capped.isEmpty ? "conversation" : capped
    }
}

/// Wraps the conversation Markdown so `ShareLink` offers it as a named `.md`
/// document. Plain value type — safe off the main actor for `Transferable`.
struct ExportedConversation: Transferable {
    let markdown: String
    let slug: String

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: UTType("net.daringfireball.markdown") ?? .plainText) { conversation in
            Data(conversation.markdown.utf8)
        }
        .suggestedFileName { "\($0.slug).md" }
    }
}
