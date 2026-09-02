import SwiftUI
import Testing
import XCTest
@testable import Graft

struct ComposerAccessoryModelsTests {
    @Test func diffPresentationAggregatesFileCounts() {
        let diff = ComposerDiffPresentation(
            id: "diff-1",
            title: "Composer polish",
            files: [
                ComposerDiffFilePresentation(
                    path: "ComposerDiffBubble.swift",
                    additions: 42,
                    deletions: 3
                ),
                ComposerDiffFilePresentation(
                    path: "ComposerPermissionCard.swift",
                    additions: 88,
                    deletions: 12
                ),
            ]
        )

        #expect(diff.fileCount == 2)
        #expect(diff.additions == 130)
        #expect(diff.deletions == 15)
    }

    @Test func permissionDecisionsMatchMobileProtocolValues() {
        #expect(ComposerPermissionDecision.allowOnce.rawValue == "allow_once")
        #expect(ComposerPermissionDecision.allowSession.rawValue == "allow_session")
        #expect(ComposerPermissionDecision.deny.rawValue == "deny")
    }

    @Test func permissionKindsUseDistinctSymbols() {
        let symbols = Set([
            ComposerPermissionKind.command.symbolName,
            ComposerPermissionKind.fileChange.symbolName,
            ComposerPermissionKind.tool.symbolName,
        ])

        #expect(symbols.count == 3)
    }
}

@MainActor
final class ComposerAccessoryRenderingTests: XCTestCase {
    func testCombinedAccessoriesRenderAtPhoneWidth() throws {
        let content = ZStack(alignment: .bottom) {
            LinearGradient(
                colors: [
                    Color.indigo.opacity(0.28),
                    Color.cyan.opacity(0.16),
                    Color(.systemBackground),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            VStack(spacing: 10) {
                ComposerAccessoryStack(
                    diffs: [
                        ComposerDiffPresentation(
                            id: "diff-1",
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
                    ],
                    permission: ComposerPermissionPresentation(
                        id: "approval-1",
                        kind: .command,
                        title: "xcodebuild test -scheme Graft",
                        detail: "Run tests using the iPhone 17 Pro simulator.",
                        toolName: "Run command"
                    ),
                    queuedPermissionCount: 2,
                    isRespondingToPermission: false,
                    onOpenDiff: { _ in },
                    onRespondToPermission: { _, _ in }
                )

                RoundedRectangle(cornerRadius: 23, style: .continuous)
                    .fill(.thinMaterial)
                    .frame(height: 46)
                    .padding(.horizontal, 12)
            }
            .padding(.bottom, 12)
        }
        .frame(width: 393, height: 700)
        .environment(\.colorScheme, .light)

        let renderer = ImageRenderer(content: content)
        renderer.scale = 3
        let image = try XCTUnwrap(renderer.uiImage)

        XCTAssertGreaterThan(image.size.width, 0)
        XCTAssertGreaterThan(image.size.height, 0)

        let attachment = XCTAttachment(image: image)
        attachment.name = "Composer accessories"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
