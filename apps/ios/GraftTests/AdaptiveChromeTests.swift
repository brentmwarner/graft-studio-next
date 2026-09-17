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
        XCTAssertEqual(AdaptiveChrome.readableColumnWidth(in: 900), 720)
        XCTAssertEqual(AdaptiveChrome.readableColumnWidth(in: 899), 899)
        XCTAssertEqual(AdaptiveChrome.readableColumnWidth(in: 834), 834)
        XCTAssertEqual(AdaptiveChrome.readableColumnWidth(in: 720), 720)
        XCTAssertEqual(AdaptiveChrome.readableColumnWidth(in: 390), 390)
        XCTAssertEqual(AdaptiveChrome.readableColumnWidth(in: 0), 0)
        XCTAssertEqual(AdaptiveChrome.readableColumnWidth(in: -40), 0)
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
            let titleMeasured = expectation(description: "Navigation title laid out at \(width)")
            let canvasMeasured = expectation(description: "Canvas laid out at \(width)")
            var sidebarFrame: CGRect?
            var detailFrame: CGRect?
            var columnFrame: CGRect?
            var titleFrame: CGRect?
            var canvasFrame: CGRect?
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
                    Color.clear
                    ScrollView {
                        Text("Chat content")
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .readableChatColumn()
                    .onGeometryChange(for: CGRect.self) {
                        $0.frame(in: .global)
                    } action: { frame in
                        if columnFrame == nil { columnMeasured.fulfill() }
                        columnFrame = frame
                    }
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
                        Text("New chat")
                            .onGeometryChange(for: CGRect.self) {
                                $0.frame(in: .global)
                            } action: { frame in
                                if titleFrame == nil { titleMeasured.fulfill() }
                                titleFrame = frame
                            }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Context", systemImage: "circle") {}
                    }
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

            await fulfillment(
                of: [sidebarMeasured, detailMeasured, columnMeasured, titleMeasured, canvasMeasured],
                timeout: 3
            )
            let sidebar = try XCTUnwrap(sidebarFrame)
            let detail = try XCTUnwrap(detailFrame)
            let column = try XCTUnwrap(columnFrame)
            let title = try XCTUnwrap(titleFrame)
            let canvas = try XCTUnwrap(canvasFrame)
            XCTAssertEqual(sidebar.minX - canvas.minX, 16, accuracy: 1)
            XCTAssertEqual(sidebar.width, 320, accuracy: 1)
            XCTAssertGreaterThan(sidebar.minY - canvas.minY, 16, "Fixed header sits above the scroll region")
            XCTAssertEqual(canvas.maxY - sidebar.maxY, 16, accuracy: 1)
            XCTAssertEqual(detail.minX, sidebar.maxX + 16, accuracy: 1)
            XCTAssertEqual(detail.width, width - 352, accuracy: 1)
            XCTAssertEqual(column.width, AdaptiveChrome.readableColumnWidth(in: width - 352), accuracy: 1)
            XCTAssertEqual(column.midX, detail.midX, accuracy: 1, "Chat centers beside Projects at \(width)pt")
            XCTAssertEqual(title.midX, detail.midX, accuracy: 1, "Navigation title centers beside Projects at \(width)pt")
        }
    }
}
