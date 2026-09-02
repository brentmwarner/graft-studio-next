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
}
