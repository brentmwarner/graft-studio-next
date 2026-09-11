import SwiftUI

/// Floating thread actions rendered directly above the message composer.
///
/// Diff summaries stay compact and horizontally scrollable. Permission prompts
/// intentionally show one request at a time so parallel tool calls never create
/// a wall of decision cards above the keyboard.
struct ComposerAccessoryStack: View {
    let diffs: [ComposerDiffPresentation]
    let permission: ComposerPermissionPresentation?
    let queuedPermissionCount: Int
    let isRespondingToPermission: Bool
    let onOpenDiff: (String) -> Void
    let onRespondToPermission: (String, ComposerPermissionDecision) -> Void

    var body: some View {
        ComposerAccessoryGlassContainer(spacing: 12) {
            VStack(spacing: 8) {
                if !diffs.isEmpty {
                    ComposerDiffBubbleStrip(
                        diffs: diffs,
                        onOpenDiff: onOpenDiff
                    )
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }

                if let permission {
                    ComposerPermissionCard(
                        id: permission.id,
                        kind: permission.kind,
                        title: permission.title,
                        detail: permission.detail,
                        toolName: permission.toolName,
                        queuedPermissionCount: queuedPermissionCount,
                        isResponding: isRespondingToPermission,
                        onDecision: { decision in
                            onRespondToPermission(permission.id, decision)
                        }
                    )
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 12)
        .animation(.smooth(duration: 0.2), value: diffs.map(\.id))
        .animation(.smooth(duration: 0.2), value: permission?.id)
    }
}

private struct ComposerAccessoryGlassContainer<Content: View>: View {
    let spacing: CGFloat
    let content: Content

    init(spacing: CGFloat, @ViewBuilder content: () -> Content) {
        self.spacing = spacing
        self.content = content()
    }

    var body: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: spacing) {
                content
            }
        } else {
            content
        }
    }
}

#Preview("Composer accessories") {
    ComposerAccessoryPreviewCanvas(
        diffs: ComposerAccessoryPreviewData.diffs,
        permission: ComposerAccessoryPreviewData.commandPermission,
        queuedPermissionCount: 2,
        isResponding: false
    )
}

#Preview("Diff bubbles") {
    ComposerAccessoryPreviewCanvas(
        diffs: ComposerAccessoryPreviewData.diffs,
        permission: nil,
        queuedPermissionCount: 0,
        isResponding: false
    )
}

#Preview("File permission") {
    ComposerAccessoryPreviewCanvas(
        diffs: [],
        permission: ComposerAccessoryPreviewData.filePermission,
        queuedPermissionCount: 0,
        isResponding: false
    )
}

#Preview("Responding") {
    ComposerAccessoryPreviewCanvas(
        diffs: ComposerAccessoryPreviewData.diffs,
        permission: ComposerAccessoryPreviewData.commandPermission,
        queuedPermissionCount: 0,
        isResponding: true
    )
}

#Preview("Accessibility text") {
    ComposerAccessoryPreviewCanvas(
        diffs: ComposerAccessoryPreviewData.diffs,
        permission: ComposerAccessoryPreviewData.commandPermission,
        queuedPermissionCount: 2,
        isResponding: false
    )
    .environment(\.dynamicTypeSize, .accessibility2)
}

#Preview("Dark appearance") {
    ComposerAccessoryPreviewCanvas(
        diffs: ComposerAccessoryPreviewData.diffs,
        permission: ComposerAccessoryPreviewData.commandPermission,
        queuedPermissionCount: 2,
        isResponding: false
    )
    .preferredColorScheme(.dark)
}

private struct ComposerAccessoryPreviewCanvas: View {
    let diffs: [ComposerDiffPresentation]
    let permission: ComposerPermissionPresentation?
    let queuedPermissionCount: Int
    let isResponding: Bool

    var body: some View {
        ZStack(alignment: .bottom) {
            LinearGradient(
                colors: [
                    Color.indigo.opacity(0.28),
                    Color.cyan.opacity(0.16),
                    Color(.systemBackground),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 10) {
                ComposerAccessoryStack(
                    diffs: diffs,
                    permission: permission,
                    queuedPermissionCount: queuedPermissionCount,
                    isRespondingToPermission: isResponding,
                    onOpenDiff: { _ in },
                    onRespondToPermission: { _, _ in }
                )

                ComposerPreviewPlaceholder()
            }
            .padding(.bottom, 12)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct ComposerPreviewPlaceholder: View {
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "plus")
                .frame(width: 46, height: 46)
                .composerGlassSurface(shape: .circle, interactive: true)

            Text(
                "Message Graft",
                comment: "Placeholder in the composer accessory component preview"
            )
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, minHeight: 46, alignment: .leading)
            .padding(.horizontal, 16)
            .composerGlassSurface(shape: .capsule, interactive: true)
        }
        .padding(.horizontal, 12)
    }
}

private enum ComposerAccessoryPreviewData {
    static let diffs = [
        ComposerDiffPresentation(
            id: "diff-pairing",
            title: "Pairing fixes",
            files: [
                ComposerDiffFilePresentation(
                    path: "PairingView.swift",
                    additions: 40,
                    deletions: 5
                ),
                ComposerDiffFilePresentation(
                    path: "QRScannerView.swift",
                    additions: 18,
                    deletions: 2
                ),
            ]
        ),
        ComposerDiffPresentation(
            id: "diff-tests",
            title: nil,
            files: [
                ComposerDiffFilePresentation(
                    path: "PairingURLTests.swift",
                    additions: 12,
                    deletions: 0
                ),
            ]
        ),
    ]

    static let commandPermission = ComposerPermissionPresentation(
        id: "approval-command",
        kind: .command,
        title: "xcodebuild test -scheme Graft",
        detail: "Run tests in the Graft iOS project using the iPhone 17 Pro simulator.",
        toolName: "Run command"
    )

    static let filePermission = ComposerPermissionPresentation(
        id: "approval-file",
        kind: .fileChange,
        title: "Update ComposerAccessoryStack.swift",
        detail: "The agent wants to edit a SwiftUI source file in this project.",
        toolName: "Edit file"
    )
}
