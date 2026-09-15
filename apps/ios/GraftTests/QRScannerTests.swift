import AVFoundation
import UIKit
import XCTest
@testable import Graft

@MainActor
final class QRScannerTests: XCTestCase {
    func testResolutionGuardPreventsDuplicateValidCallbacks() {
        let guardUnderTest = QRScannerResolutionGuard()
        var acceptedValues: [String] = []

        let firstAccepted = guardUnderTest.evaluate(rawValue: "valid-one") { rawValue in
            acceptedValues.append(rawValue)
            return true
        }
        let secondAccepted = guardUnderTest.evaluate(rawValue: "valid-two") { rawValue in
            acceptedValues.append(rawValue)
            return true
        }

        XCTAssertTrue(firstAccepted)
        XCTAssertFalse(secondAccepted)
        XCTAssertEqual(acceptedValues, ["valid-one"])
    }

    func testResolutionGuardPermitsValidRetryAfterInvalidCode() {
        let guardUnderTest = QRScannerResolutionGuard()
        var scannedValues: [String] = []

        let invalidAccepted = guardUnderTest.evaluate(rawValue: "not-graft") { rawValue in
            scannedValues.append(rawValue)
            return false
        }
        let validAccepted = guardUnderTest.evaluate(rawValue: "valid-graft") { rawValue in
            scannedValues.append(rawValue)
            return true
        }

        XCTAssertFalse(invalidAccepted)
        XCTAssertTrue(validAccepted)
        XCTAssertEqual(scannedValues, ["not-graft", "valid-graft"])
    }

    func testRawScannedInputParserAcceptsGraftPairingURLAndRejectsUnrelatedQR() {
        let raw = "graft://pair?v=1&host=http%3A%2F%2F127.0.0.1%3A4783#token=abcdefghijklmnop"

        XCTAssertNotNil(PairingURLParser.parse(raw))
        XCTAssertNil(PairingURLParser.parse("https://example.com/unrelated"))
        XCTAssertNil(PairingURLParser.parse("plain unrelated QR text"))
    }

    func testPermissionIsRequestedBeforeUnavailableCameraFallback() {
        XCTAssertEqual(QRScannerState.resolve(
            authorization: .notDetermined, isSupported: true, isAvailable: false
        ), .requestingPermission)
        XCTAssertEqual(QRScannerState.resolve(
            authorization: .denied, isSupported: true, isAvailable: false
        ), .denied)
        XCTAssertEqual(QRScannerState.resolve(
            authorization: .restricted, isSupported: false, isAvailable: false
        ), .denied)
    }

    func testAuthorizedScannerRequiresAvailableHardware() {
        XCTAssertEqual(QRScannerState.resolve(
            authorization: .authorized, isSupported: true, isAvailable: true
        ), .scanning)
        for supported in [false, true] {
            guard case .unavailable = QRScannerState.resolve(
                authorization: .authorized, isSupported: supported, isAvailable: false
            ) else { return XCTFail("An unavailable camera must show a fallback") }
        }
    }

    func testCameraStartsOnlyAfterChildControllerAppears() {
        let scanner = FakeQRScannerController()
        let host = QRScannerHostController(scanner: scanner, onBecameUnavailable: { _ in })
        host.setActive(true)
        host.loadViewIfNeeded()
        XCTAssertTrue(scanner.parent === host)
        XCTAssertEqual(scanner.startCount, 0)

        host.beginAppearanceTransition(true, animated: false)
        XCTAssertEqual(scanner.startCount, 0)
        host.endAppearanceTransition()
        XCTAssertEqual(scanner.startCount, 1)
        host.setActive(true)
        XCTAssertEqual(scanner.startCount, 1, "SwiftUI updates must not start duplicate sessions")
    }

    func testCameraPausesAndResumesWithAppActivity() {
        let scanner = FakeQRScannerController()
        let host = QRScannerHostController(scanner: scanner, onBecameUnavailable: { _ in })
        show(host)
        XCTAssertEqual(scanner.startCount, 0, "Do not start during an inactive presentation")
        host.setActive(true)
        XCTAssertEqual(scanner.startCount, 1)
        host.setActive(false)
        XCTAssertFalse(scanner.isScanning)
        host.setActive(true)
        XCTAssertEqual(scanner.startCount, 2)
    }

    func testDismissedCameraDoesNotRestartOnForeground() {
        let scanner = FakeQRScannerController()
        let host = QRScannerHostController(scanner: scanner, onBecameUnavailable: { _ in })
        host.setActive(true)
        show(host)
        host.beginAppearanceTransition(false, animated: false)
        host.endAppearanceTransition()
        XCTAssertFalse(scanner.isScanning)
        host.setActive(false)
        host.setActive(true)
        XCTAssertEqual(scanner.startCount, 1)
    }

    func testAcceptedCodeOrDismantledControllerCannotRestart() {
        let scanner = FakeQRScannerController()
        let host = QRScannerHostController(scanner: scanner, onBecameUnavailable: { _ in })
        host.setActive(true)
        show(host)
        host.finishScanning()
        XCTAssertFalse(scanner.isScanning)
        host.setActive(false)
        host.setActive(true)
        XCTAssertEqual(scanner.startCount, 1)
    }

    func testStartupFailureShowsFallbackOnceInsteadOfRetryingBlackPreview() async {
        let scanner = FakeQRScannerController()
        scanner.failsToStart = true
        let unavailable = expectation(description: "Scanner fallback")
        unavailable.assertForOverFulfill = true
        let host = QRScannerHostController(scanner: scanner) { message in
            XCTAssertFalse(message.isEmpty)
            unavailable.fulfill()
        }
        host.setActive(true)
        show(host)
        host.setActive(true)
        await fulfillment(of: [unavailable], timeout: 1)
        XCTAssertEqual(scanner.startCount, 1)
        XCTAssertFalse(scanner.isScanning)
    }

    private func show(_ host: QRScannerHostController) {
        host.loadViewIfNeeded()
        host.beginAppearanceTransition(true, animated: false)
        host.endAppearanceTransition()
    }
}

@MainActor
private final class FakeQRScannerController: UIViewController, QRScanningController {
    var isScanning = false
    var startCount = 0
    var failsToStart = false

    func startScanning() throws {
        startCount += 1
        if failsToStart { throw NSError(domain: "QRScannerTests", code: 1) }
        isScanning = true
    }

    func stopScanning() {
        isScanning = false
    }
}
