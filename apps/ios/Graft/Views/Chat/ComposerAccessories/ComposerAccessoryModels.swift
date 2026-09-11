import Foundation

/// Small, view-facing diff model for the composer accessory strip.
///
/// The remote protocol remains the source of truth. Thread state maps its diff
/// payload into this type so the SwiftUI component does not depend on transport
/// DTOs that can change independently.
struct ComposerDiffPresentation: Equatable, Identifiable, Sendable {
    let id: String
    let title: String?
    let files: [ComposerDiffFilePresentation]

    var fileCount: Int { files.count }
    var additions: Int { files.reduce(0) { $0 + $1.additions } }
    var deletions: Int { files.reduce(0) { $0 + $1.deletions } }
}

struct ComposerDiffFilePresentation: Equatable, Identifiable, Sendable {
    let path: String
    let additions: Int
    let deletions: Int

    var id: String { path }
}

/// The visual category controls only the symbol shown by the permission card.
/// Authorization semantics live in `ComposerPermissionDecision`.
enum ComposerPermissionKind: Equatable, Sendable {
    case command
    case fileChange
    case tool

    var symbolName: String {
        switch self {
        case .command:
            "terminal"
        case .fileChange:
            "doc.badge.ellipsis"
        case .tool:
            "wrench.and.screwdriver"
        }
    }
}

struct ComposerPermissionPresentation: Equatable, Identifiable, Sendable {
    let id: String
    let kind: ComposerPermissionKind
    let title: String
    let detail: String?
    let toolName: String?
}

enum ComposerPermissionDecision: String, Equatable, Sendable {
    case allowOnce = "allow_once"
    case allowSession = "allow_session"
    case deny
}
