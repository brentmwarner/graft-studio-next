import SwiftUI

struct ComposerPermissionCard: View {
    let id: String
    let kind: ComposerPermissionKind
    let title: String
    let detail: String?
    let toolName: String?
    let queuedPermissionCount: Int
    let isResponding: Bool
    let onDecision: (ComposerPermissionDecision) -> Void

    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PermissionCardHeader(
                symbolName: kind.symbolName,
                title: title,
                toolName: toolName,
                queuedPermissionCount: queuedPermissionCount,
                hasDetail: hasDetail,
                isExpanded: isExpanded,
                onToggleDetail: toggleDetail
            )

            if isExpanded, let detail, !detail.isEmpty {
                PermissionCardDetail(detail: detail)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }

            PermissionCardActions(
                isResponding: isResponding,
                onDecision: onDecision
            )
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .composerGlassSurface(shape: .roundedRectangle(cornerRadius: 20), interactive: false)
        .animation(.snappy(duration: 0.18), value: isExpanded)
        .accessibilityIdentifier("composer-permission-card-\(id)")
    }

    private var hasDetail: Bool {
        guard let detail else { return false }
        return !detail.isEmpty
    }

    private func toggleDetail() {
        guard hasDetail else { return }
        isExpanded.toggle()
    }
}

private struct PermissionCardHeader: View {
    let symbolName: String
    let title: String
    let toolName: String?
    let queuedPermissionCount: Int
    let hasDetail: Bool
    let isExpanded: Bool
    let onToggleDetail: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            if hasDetail {
                Button(action: onToggleDetail) {
                    PermissionCardHeaderContent(
                        symbolName: symbolName,
                        title: title,
                        toolName: toolName,
                        queuedPermissionCount: queuedPermissionCount,
                        showsDisclosure: true,
                        isExpanded: isExpanded
                    )
                }
                .buttonStyle(.plain)
                .accessibilityHint(
                    Text(
                        isExpanded ? "Collapses request details" : "Shows request details",
                        comment: "Accessibility hint for permission request details disclosure"
                    )
                )
            } else {
                PermissionCardHeaderContent(
                    symbolName: symbolName,
                    title: title,
                    toolName: toolName,
                    queuedPermissionCount: queuedPermissionCount,
                    showsDisclosure: false,
                    isExpanded: false
                )
            }
        }
        .accessibilityLabel(
            Text(
                "Permission required: \(title)",
                comment: "Accessibility label for an agent permission request"
            )
        )
    }
}

private struct PermissionCardHeaderContent: View {
    let symbolName: String
    let title: String
    let toolName: String?
    let queuedPermissionCount: Int
    let showsDisclosure: Bool
    let isExpanded: Bool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: symbolName)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 30, height: 30)
                .background(.fill.tertiary, in: Circle())

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(
                        "Permission required",
                        comment: "Title above an agent permission request"
                    )
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)

                    if queuedPermissionCount > 0 {
                        Text(
                            "\(queuedPermissionCount) more",
                            comment: "Count of additional agent permission requests waiting in a queue"
                        )
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                    }
                }

                if let toolName, !toolName.isEmpty {
                    Text(toolName)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Text(title)
                    .font(.footnote.monospaced().weight(.medium))
                    .foregroundStyle(.primary)
                    .lineLimit(isExpanded ? 4 : 1)
                    .multilineTextAlignment(.leading)
            }

            Spacer(minLength: 4)

            if showsDisclosure {
                Image(systemName: "chevron.down")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.tertiary)
                    .rotationEffect(.degrees(isExpanded ? 180 : 0))
            }
        }
        .contentShape(Rectangle())
    }
}

private struct PermissionCardDetail: View {
    let detail: String

    var body: some View {
        ScrollView {
            Text(detail)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
        }
        .frame(maxHeight: 132)
        .background(.fill.quaternary, in: .rect(cornerRadius: 12))
        .accessibilityLabel(
            Text(
                "Request details: \(detail)",
                comment: "Expanded technical details for an agent permission request"
            )
        )
    }
}

private struct PermissionCardActions: View {
    let isResponding: Bool
    let onDecision: (ComposerPermissionDecision) -> Void

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Group {
            if dynamicTypeSize >= .xxLarge {
                PermissionCardActionColumn(
                    isResponding: isResponding,
                    onDecision: onDecision
                )
            } else {
                PermissionCardActionRow(
                    isResponding: isResponding,
                    onDecision: onDecision
                )
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .controlSize(.small)
        .disabled(isResponding)
    }
}

private struct PermissionCardActionRow: View {
    let isResponding: Bool
    let onDecision: (ComposerPermissionDecision) -> Void

    var body: some View {
        HStack(spacing: 8) {
            PermissionResponseProgress(isResponding: isResponding)
            PermissionDecisionButtons(onDecision: onDecision)
        }
        .fixedSize(horizontal: true, vertical: false)
    }
}

private struct PermissionCardActionColumn: View {
    let isResponding: Bool
    let onDecision: (ComposerPermissionDecision) -> Void

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            PermissionResponseProgress(isResponding: isResponding)
            PermissionDecisionButtonColumn(onDecision: onDecision)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

private struct PermissionResponseProgress: View {
    let isResponding: Bool

    var body: some View {
        ZStack {
            if isResponding {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityLabel(
                        Text(
                            "Responding to permission request",
                            comment: "Progress indicator while a permission decision is sent"
                        )
                    )
            }
        }
        .frame(width: isResponding ? 28 : 0, height: 28)
    }
}

private struct PermissionDecisionButtons: View {
    let onDecision: (ComposerPermissionDecision) -> Void

    var body: some View {
        HStack(spacing: 8) {
            PermissionDecisionButton(
                title: "Deny",
                decision: .deny,
                role: .destructive,
                isProminent: false,
                fillsWidth: false,
                onDecision: onDecision
            )
            PermissionDecisionButton(
                title: "For session",
                decision: .allowSession,
                role: nil,
                isProminent: false,
                fillsWidth: false,
                onDecision: onDecision
            )
            PermissionDecisionButton(
                title: "Allow once",
                decision: .allowOnce,
                role: nil,
                isProminent: true,
                fillsWidth: false,
                onDecision: onDecision
            )
        }
    }
}

private struct PermissionDecisionButtonColumn: View {
    let onDecision: (ComposerPermissionDecision) -> Void

    var body: some View {
        VStack(spacing: 8) {
            PermissionDecisionButton(
                title: "Allow once",
                decision: .allowOnce,
                role: nil,
                isProminent: true,
                fillsWidth: true,
                onDecision: onDecision
            )
            PermissionDecisionButton(
                title: "For session",
                decision: .allowSession,
                role: nil,
                isProminent: false,
                fillsWidth: true,
                onDecision: onDecision
            )
            PermissionDecisionButton(
                title: "Deny",
                decision: .deny,
                role: .destructive,
                isProminent: false,
                fillsWidth: true,
                onDecision: onDecision
            )
        }
        .frame(maxWidth: .infinity)
    }
}

private struct PermissionDecisionButton: View {
    let title: LocalizedStringKey
    let decision: ComposerPermissionDecision
    let role: ButtonRole?
    let isProminent: Bool
    let fillsWidth: Bool
    let onDecision: (ComposerPermissionDecision) -> Void

    var body: some View {
        if isProminent {
            Button(role: role) {
                onDecision(decision)
            } label: {
                Text(title)
                    .frame(maxWidth: fillsWidth ? .infinity : nil)
            }
            .buttonStyle(.glassProminent)
        } else {
            Button(role: role) {
                onDecision(decision)
            } label: {
                Text(title)
                    .frame(maxWidth: fillsWidth ? .infinity : nil)
            }
            .buttonStyle(.glass)
        }
    }
}
