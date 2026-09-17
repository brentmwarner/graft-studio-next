import SwiftUI
import UIKit
import XCTest
@testable import Graft

final class AdaptiveChromeTests: XCTestCase {
    func testRegularHorizontalSizeClassUsesPersistentSidebar() {
        XCTAssertTrue(AdaptiveChrome.usesPersistentSidebar(horizontalSizeClass: .regular))
        XCTAssertFalse(AdaptiveChrome.usesPersistentSidebar(horizontalSizeClass: .compact))
        XCTAssertFalse(AdaptiveChrome.usesPersistentSidebar(horizontalSizeClass: nil))
    }

    func testVisiblePanelReservesChatSpaceAtEveryRegularWidth() {
        let presentation = AdaptiveChrome.SidebarPresentation()
        XCTAssertTrue(presentation.isVisible)
        for width in [
            AdaptiveChrome.Canvas.iPadMiniPortrait,
            AdaptiveChrome.Canvas.iPadMiniLandscape,
            AdaptiveChrome.Canvas.iPad11Portrait,
            AdaptiveChrome.Canvas.iPad11Landscape,
            AdaptiveChrome.Canvas.iPad13Portrait,
            AdaptiveChrome.Canvas.iPad13Landscape,
        ] {
            let inset = presentation.chatLeadingInset(in: width)
            XCTAssertEqual(inset, 352, "Reserve the 320pt panel plus both 16pt margins at \(width)pt")
            XCTAssertGreaterThanOrEqual(width - inset, 392, "Chat stays beside the panel at \(width)pt")
        }
    }

    func testHiddenPanelReturnsItsSpaceToChatAndReopeningRestoresIt() {
        var presentation = AdaptiveChrome.SidebarPresentation()
        for width in [
            AdaptiveChrome.Canvas.iPadMiniPortrait,
            AdaptiveChrome.Canvas.iPad11Portrait,
            AdaptiveChrome.Canvas.iPad13Landscape,
        ] {
            presentation.isVisible = false
            XCTAssertEqual(presentation.chatLeadingInset(in: width), 0)
            presentation.isVisible = true
            XCTAssertEqual(presentation.chatLeadingInset(in: width), 352)
        }
    }

    func testChatInsetFitsResizedAndEmptyContainers() {
        let presentation = AdaptiveChrome.SidebarPresentation()
        XCTAssertEqual(presentation.chatLeadingInset(in: 600), 352)
        XCTAssertEqual(presentation.chatLeadingInset(in: 300), 300)
        XCTAssertEqual(presentation.chatLeadingInset(in: 16), 16)
        XCTAssertEqual(presentation.chatLeadingInset(in: 0), 0)
        XCTAssertEqual(presentation.chatLeadingInset(in: -40), 0)
    }

    func testFloatingGeometryRemainsInsetAndFitsResizedWindows() {
        XCTAssertEqual(AdaptiveChrome.sidebarMargin, 16)
        XCTAssertEqual(AdaptiveChrome.sidebarCornerRadius, 28)
        XCTAssertEqual(AdaptiveChrome.sidebarWidth(in: 1_024), 320)
        XCTAssertEqual(AdaptiveChrome.sidebarWidth(in: 300), 268)
        XCTAssertEqual(AdaptiveChrome.sidebarWidth(in: 0), 0)
        XCTAssertEqual(AdaptiveChrome.sidebarWidth(in: -40), 0)
    }

    func testOnlyCompactInboxPaintsOverTheDrawer() {
        XCTAssertFalse(AdaptiveChrome.paintsOpaqueInboxBackground(usesPersistentSidebar: true))
        XCTAssertTrue(AdaptiveChrome.paintsOpaqueInboxBackground(usesPersistentSidebar: false))
    }

    @MainActor
    func testRenderedPanelIsInsetAndChatCentersInRemainingPane() async throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        for width in [
            AdaptiveChrome.Canvas.iPadMiniPortrait,
            AdaptiveChrome.Canvas.iPadMiniLandscape,
            AdaptiveChrome.Canvas.iPad11Portrait,
            AdaptiveChrome.Canvas.iPad11Landscape,
            AdaptiveChrome.Canvas.iPad13Portrait,
            AdaptiveChrome.Canvas.iPad13Landscape,
        ] {
            let sidebarMeasured = expectation(description: "Sidebar laid out at \(width)")
            let detailMeasured = expectation(description: "Chat laid out at \(width)")
            let columnMeasured = expectation(description: "Readable column laid out at \(width)")
            let composerMeasured = expectation(description: "Composer laid out at \(width)")
            let titleMeasured = expectation(description: "Navigation title laid out at \(width)")
            let canvasMeasured = expectation(description: "Canvas laid out at \(width)")
            let backgroundMeasured = expectation(description: "Chat background laid out at \(width)")
            var sidebarFrame: CGRect?
            var detailFrame: CGRect?
            var columnFrame: CGRect?
            var composerFrame: CGRect?
            var titleFrame: CGRect?
            var canvasFrame: CGRect?
            var backgroundFrame: CGRect?
            let app = AppModel(store: LocalStore(inMemory: true))
            let chat = ChatModel(threadId: "centering", title: "New chat", app: app)
            let answer = TranscriptItem(kind: .assistant)
            answer.text = "The transcript and composer should share a readable column centered in the space beside Projects, including when this paragraph wraps in a narrow pane."
            chat.applyReconciledItems([.user("Check the chat layout."), answer])
            let view = FloatingSidebarLayout(
                hostLabel: "Mac",
                isConnected: true,
                onSettings: {},
                onMore: {}
            ) {
                Color.clear.onGeometryChange(for: CGRect.self) {
                    $0.frame(in: .global)
                } action: { frame in
                    if sidebarFrame == nil { sidebarMeasured.fulfill() }
                    sidebarFrame = frame
                }
            } detail: {
                ZStack {
                    Color(.systemBackground)
                        .onGeometryChange(for: CGRect.self) {
                            $0.frame(in: .global)
                        } action: { frame in
                            if backgroundFrame == nil { backgroundMeasured.fulfill() }
                            backgroundFrame = frame
                        }
                        .ignoresSafeArea()
                    TranscriptView(chat: chat)
                        // Measure the content, before the full-pane centering frame.
                        .onGeometryChange(for: CGRect.self) {
                            $0.frame(in: .global)
                        } action: { frame in
                            if columnFrame == nil { columnMeasured.fulfill() }
                            columnFrame = frame
                        }
                        .readableChatColumn()
                }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    ThreadComposerDock(chat: chat)
                        .onGeometryChange(for: CGRect.self) {
                            $0.frame(in: .global)
                        } action: { frame in
                            if composerFrame == nil { composerMeasured.fulfill() }
                            composerFrame = frame
                        }
                        .readableChatColumn()
                }
                .onGeometryChange(for: CGRect.self) {
                    $0.frame(in: .global)
                } action: { frame in
                    if detailFrame == nil { detailMeasured.fulfill() }
                    detailFrame = frame
                }
                .navigationTitle("New chat")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .principal) {
                        ChatNavigationTitle {
                            Text("New chat")
                                .onGeometryChange(for: CGRect.self) {
                                    $0.frame(in: .global)
                                } action: { frame in
                                    if titleFrame == nil { titleMeasured.fulfill() }
                                    titleFrame = frame
                                }
                        }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Context", systemImage: "circle") {}
                    }
                }
            }
            .environment(app)
            .frame(width: width, height: 900)
            .onGeometryChange(for: CGRect.self) {
                $0.frame(in: .global)
            } action: { frame in
                if canvasFrame == nil { canvasMeasured.fulfill() }
                canvasFrame = frame
            }
            let window = UIWindow(windowScene: scene)
            window.rootViewController = UIHostingController(rootView: view)
            window.isHidden = false
            defer { window.isHidden = true }

            await fulfillment(
                of: [sidebarMeasured, detailMeasured, columnMeasured, composerMeasured, titleMeasured, canvasMeasured, backgroundMeasured],
                timeout: 3
            )
            let sidebar = try XCTUnwrap(sidebarFrame)
            let detail = try XCTUnwrap(detailFrame)
            let column = try XCTUnwrap(columnFrame)
            let composer = try XCTUnwrap(composerFrame)
            let title = try XCTUnwrap(titleFrame)
            let canvas = try XCTUnwrap(canvasFrame)
            let background = try XCTUnwrap(backgroundFrame)
            XCTAssertEqual(background.minX, canvas.minX, accuracy: 1, "Chat canvas extends behind Projects")
            XCTAssertEqual(background.maxX, canvas.maxX, accuracy: 1, "One chat canvas spans the entire window")
            XCTAssertEqual(sidebar.minX - canvas.minX, 16, accuracy: 1)
            XCTAssertEqual(sidebar.width, 320, accuracy: 1)
            XCTAssertGreaterThan(sidebar.minY - canvas.minY, 16, "Fixed header sits above the scroll region")
            XCTAssertEqual(canvas.maxY - sidebar.maxY, 16, accuracy: 1)
            XCTAssertEqual(detail.minX, sidebar.maxX + 16, accuracy: 1)
            XCTAssertEqual(detail.width, width - 352, accuracy: 1)
            for (name, frame) in [("Transcript", column), ("Composer", composer)] {
                XCTAssertEqual(frame.width, min(720, detail.width), accuracy: 1, "\(name) uses the pane proposal")
                XCTAssertEqual(frame.midX, detail.midX, accuracy: 1, "\(name) centers beside Projects at \(width)pt")
                XCTAssertEqual(frame.minX - detail.minX, detail.maxX - frame.maxX, accuracy: 1)
                XCTAssertGreaterThanOrEqual(frame.minX, detail.minX)
                XCTAssertLessThanOrEqual(frame.maxX, detail.maxX)
            }
            XCTAssertEqual(title.midX, detail.midX, accuracy: 1, "Navigation title centers beside Projects at \(width)pt")
        }
    }

    @MainActor
    func testReadableColumnUsesParentProposalInsideLargerNavigationContainer() async throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        // A narrower parent must win even when the nearest SwiftUI container
        // remains the full window (for example, a resized or nested chat pane).
        for paneWidth: CGFloat in [390, 672, 842, 1_014, 1_366] {
            let measured = expectation(description: "Content laid out in \(paneWidth)pt pane")
            var contentFrame: CGRect?
            var paneFrame: CGRect?
            let view = NavigationStack {
                Color.clear
                    .frame(height: 80)
                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { frame in
                        if contentFrame == nil { measured.fulfill() }
                        contentFrame = frame
                    }
                    .readableChatColumn()
                    .frame(width: paneWidth)
                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { paneFrame = $0 }
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .frame(width: 1_366, height: 900)
            let window = UIWindow(windowScene: scene)
            window.rootViewController = UIHostingController(rootView: view)
            window.isHidden = false
            defer { window.isHidden = true }
            await fulfillment(of: [measured], timeout: 3)
            let content = try XCTUnwrap(contentFrame)
            let pane = try XCTUnwrap(paneFrame)
            XCTAssertEqual(content.width, min(720, paneWidth), accuracy: 1)
            XCTAssertEqual(content.midX, pane.midX, accuracy: 1)
            XCTAssertGreaterThanOrEqual(content.minX, pane.minX)
            XCTAssertLessThanOrEqual(content.maxX, pane.maxX)
        }
    }
}
