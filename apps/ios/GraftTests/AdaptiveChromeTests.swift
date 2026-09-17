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

    func testReadableColumnWidthCapsWideContainersAndLeavesPhoneWidthsAlone() {
        XCTAssertEqual(AdaptiveChrome.readableColumnWidth(in: 1_204), 720)
        XCTAssertEqual(AdaptiveChrome.readableColumnWidth(in: 720), 720)
        XCTAssertEqual(AdaptiveChrome.readableColumnWidth(in: 390), 390)
        XCTAssertEqual(AdaptiveChrome.readableColumnWidth(in: 0), 0)
        XCTAssertEqual(AdaptiveChrome.readableColumnWidth(in: -40), 0)
    }

    func testLandscapePinsFloatingPanelAndLeavesAReadableChatColumn() {
        let presentation = AdaptiveChrome.SidebarPresentation()
        for width in [
            AdaptiveChrome.Canvas.iPadMiniLandscape,
            AdaptiveChrome.Canvas.iPad11Landscape,
            AdaptiveChrome.Canvas.iPad13Landscape,
        ] {
            XCTAssertTrue(presentation.isPinned(in: width))
            let inset = presentation.chatLeadingInset(in: width)
            XCTAssertEqual(inset, 352, "Reserve the 320pt panel plus both 16pt margins")
            XCTAssertGreaterThanOrEqual(width - inset, AdaptiveChrome.readableColumnMaxWidth)
        }
    }

    func testNarrowPortraitOverlaysAndDismissesAfterSelection() {
        for width in [
            AdaptiveChrome.Canvas.iPadMiniPortrait,
            AdaptiveChrome.Canvas.iPad11Portrait,
        ] {
            var presentation = AdaptiveChrome.SidebarPresentation()
            XCTAssertFalse(presentation.isPinned(in: width))
            XCTAssertEqual(presentation.chatLeadingInset(in: width), 0)
            presentation.didSelectDestination(in: width)
            XCTAssertFalse(presentation.isVisible)
            XCTAssertTrue(presentation.prefersPinned, "Resizing must retain the pin preference")
            presentation.isVisible = true
            XCTAssertFalse(presentation.isPinned(in: width), "Reopening must still overlay a narrow chat")
        }
    }

    func testWidePortraitKeepsFloatingPanelAfterSelection() {
        let width = AdaptiveChrome.Canvas.iPad13Portrait
        var presentation = AdaptiveChrome.SidebarPresentation()
        XCTAssertTrue(presentation.isPinned(in: width))
        XCTAssertGreaterThanOrEqual(width - presentation.chatLeadingInset(in: width), 640)
        presentation.didSelectDestination(in: width)
        XCTAssertTrue(presentation.isVisible)
    }

    func testUnpinningOverlaysWithoutReservingChatSpace() {
        let width = AdaptiveChrome.Canvas.iPad13Landscape
        var presentation = AdaptiveChrome.SidebarPresentation()
        presentation.prefersPinned = false
        XCTAssertTrue(presentation.isVisible)
        XCTAssertFalse(presentation.isPinned(in: width))
        XCTAssertEqual(presentation.chatLeadingInset(in: width), 0)
        presentation.didSelectDestination(in: width)
        XCTAssertFalse(presentation.isVisible)
        presentation.isVisible = true
        XCTAssertFalse(presentation.isPinned(in: width), "Reopening preserves the overlay preference")
        presentation.prefersPinned = true
        XCTAssertTrue(presentation.isPinned(in: width))
    }

    func testHiddenPanelReturnsItsSpaceToChat() {
        let width = AdaptiveChrome.Canvas.iPad13Landscape
        var presentation = AdaptiveChrome.SidebarPresentation()
        presentation.isVisible = false
        XCTAssertFalse(presentation.isPinned(in: width))
        XCTAssertEqual(presentation.chatLeadingInset(in: width), 0)
        presentation.isVisible = true
        XCTAssertTrue(presentation.isPinned(in: width))
    }

    func testFloatingGeometryRemainsInsetAndFitsResizedWindows() {
        XCTAssertEqual(AdaptiveChrome.sidebarMargin, 16)
        XCTAssertEqual(AdaptiveChrome.sidebarCornerRadius, 28)
        XCTAssertEqual(AdaptiveChrome.sidebarWidth(in: 1_024), 320)
        XCTAssertEqual(AdaptiveChrome.sidebarWidth(in: 300), 268)
        XCTAssertEqual(AdaptiveChrome.sidebarWidth(in: 0), 0)
        XCTAssertEqual(AdaptiveChrome.sidebarWidth(in: -40), 0)
        XCTAssertFalse(AdaptiveChrome.canPinSidebar(containerWidth: 899))
        XCTAssertTrue(AdaptiveChrome.canPinSidebar(containerWidth: 900))
    }

    func testOnlyCompactInboxPaintsOverTheDrawer() {
        XCTAssertFalse(AdaptiveChrome.paintsOpaqueInboxBackground(usesPersistentSidebar: true))
        XCTAssertTrue(AdaptiveChrome.paintsOpaqueInboxBackground(usesPersistentSidebar: false))
    }

    @MainActor
    func testRenderedPanelIsInsetAndPinnedChatDoesNotExtendUnderIt() async throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        for width: CGFloat in [834, 1_024, 1_366] {
            let sidebarMeasured = expectation(description: "Sidebar laid out at \(width)")
            let detailMeasured = expectation(description: "Chat laid out at \(width)")
            let canvasMeasured = expectation(description: "Canvas laid out at \(width)")
            var sidebarFrame: CGRect?
            var detailFrame: CGRect?
            var canvasFrame: CGRect?
            let view = FloatingSidebarLayout(
                hostLabel: "Mac",
                isConnected: true,
                selectionID: UUID(),
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
                Color.clear.onGeometryChange(for: CGRect.self) {
                    $0.frame(in: .global)
                } action: { frame in
                    if detailFrame == nil { detailMeasured.fulfill() }
                    detailFrame = frame
                }
            }
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

            await fulfillment(of: [sidebarMeasured, detailMeasured, canvasMeasured], timeout: 3)
            let sidebar = try XCTUnwrap(sidebarFrame)
            let detail = try XCTUnwrap(detailFrame)
            let canvas = try XCTUnwrap(canvasFrame)
            XCTAssertEqual(sidebar.minX - canvas.minX, 16, accuracy: 1)
            XCTAssertEqual(sidebar.width, 320, accuracy: 1)
            XCTAssertGreaterThan(sidebar.minY - canvas.minY, 16, "Fixed header sits above the scroll region")
            XCTAssertEqual(canvas.maxY - sidebar.maxY, 16, accuracy: 1)
            if width >= 900 {
                XCTAssertEqual(detail.minX, sidebar.maxX + 16, accuracy: 1)
                XCTAssertEqual(detail.width, width - 352, accuracy: 1)
            } else {
                XCTAssertEqual(detail.minX, canvas.minX, accuracy: 1)
                XCTAssertEqual(detail.width, width, accuracy: 1)
            }
        }
    }
}
