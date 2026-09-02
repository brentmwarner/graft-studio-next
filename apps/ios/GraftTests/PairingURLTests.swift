import XCTest
@testable import Graft

/// Tests for `PairingURLParser`.
///
/// The canonical format is `graft://pair?v=1&host=<url>#token=<tok>`.
/// The token lives in the fragment (after `#`) so it is never sent to
/// intermediate servers or logged in standard URL access logs.
final class PairingURLTests: XCTestCase {

    func testValidPairingURL() throws {
        let raw = "graft://pair?v=1&host=http%3A%2F%2F100.64.0.12%3A4783#token=abcdef1234567890"
        let payload = try XCTUnwrap(PairingURLParser.parseURL(raw))

        XCTAssertEqual(payload.v, 1)
        XCTAssertEqual(payload.host, "http://100.64.0.12:4783")
        XCTAssertEqual(payload.token, "abcdef1234567890")
        XCTAssertNil(payload.label)
    }

    func testPairingURLWithLabel() throws {
        let raw = "graft://pair?v=1&host=http%3A%2F%2F127.0.0.1%3A4783&label=Studio%20Mac#token=tok999tok999tok9"
        let payload = try XCTUnwrap(PairingURLParser.parseURL(raw))

        XCTAssertEqual(payload.host, "http://127.0.0.1:4783")
        XCTAssertEqual(payload.label, "Studio Mac")
        XCTAssertEqual(payload.token, "tok999tok999tok9")
    }

    func testPairingURLWithEndpointKind() throws {
        let raw = "graft://pair?v=1&host=http%3A%2F%2F100.64.0.12%3A4783&endpointKind=tailnet#token=tokABCtokABCtokA"
        let payload = try XCTUnwrap(PairingURLParser.parseURL(raw))

        XCTAssertEqual(payload.endpointKind, "tailnet")
        XCTAssertEqual(payload.token, "tokABCtokABCtokA")
    }

    /// A relay pairing link carries a public HTTPS host instead of a private
    /// address, so the phone can pair from any network.
    func testPairingURLWithRelayEndpoint() throws {
        let raw = "graft://pair?v=1&host=https%3A%2F%2Frelay.graftapp.io%2Fe%2Fenv-9f2c&label=Studio%20Mac&endpointKind=relay#token=tokRELAYtokRELAY"
        let payload = try XCTUnwrap(PairingURLParser.parseURL(raw))

        XCTAssertEqual(payload.endpointKind, "relay")
        XCTAssertEqual(payload.host, "https://relay.graftapp.io/e/env-9f2c")
        XCTAssertEqual(payload.label, "Studio Mac")
        XCTAssertEqual(payload.token, "tokRELAYtokRELAY")
    }

    func testPairingURLMissingHost() {
        XCTAssertNil(PairingURLParser.parseURL("graft://pair?v=1#token=abc"))
    }

    func testPairingURLWrongScheme() {
        XCTAssertNil(
            PairingURLParser.parseURL(
                "https://pair?v=1&host=http://127.0.0.1:4783#token=abc"
            )
        )
    }

    func testPairingURLWrongHost() {
        XCTAssertNil(
            PairingURLParser.parseURL(
                "graft://connect?v=1&host=http://127.0.0.1:4783#token=abc"
            )
        )
    }

    func testPairingURLMissingToken() {
        let raw = "graft://pair?v=1&host=http%3A%2F%2F127.0.0.1%3A4783"
        XCTAssertNil(PairingURLParser.parseURL(raw))
    }

    func testPairingURLRejectsInvalidVersion() {
        let raw = "graft://pair?v=2&host=http%3A%2F%2F127.0.0.1%3A4783#token=abcdefghijklmnop"
        XCTAssertNil(PairingURLParser.parseURL(raw))
    }

    func testPairingURLRejectsRelativeOrUnsupportedHosts() {
        let token = "abcdefghijklmnop"
        XCTAssertNil(PairingURLParser.parseURL("graft://pair?v=1&host=%2Frelative#token=\(token)"))
        XCTAssertNil(PairingURLParser.parseURL("graft://pair?v=1&host=ftp%3A%2F%2Fexample.com#token=\(token)"))
        XCTAssertNil(PairingURLParser.parseURL("graft://pair?v=1&host=https%3A%2F%2F#token=\(token)"))
    }

    func testPairingURLRejectsInvalidTokens() {
        let host = "http%3A%2F%2F127.0.0.1%3A4783"
        XCTAssertNil(PairingURLParser.parseURL("graft://pair?v=1&host=\(host)#token=short"))
        XCTAssertNil(PairingURLParser.parseURL("graft://pair?v=1&host=\(host)#token=abcdefghijklmnop!"))
        XCTAssertNil(
            PairingURLParser.parseURL(
                "graft://pair?v=1&host=\(host)#token=\(String(repeating: "a", count: 257))"
            )
        )
    }

    func testPairingURLRejectsEmptyOrOversizedLabels() {
        let token = "abcdefghijklmnop"
        let host = "http%3A%2F%2F127.0.0.1%3A4783"
        XCTAssertNil(PairingURLParser.parseURL("graft://pair?v=1&host=\(host)&label=%20%20#token=\(token)"))
        XCTAssertNil(
            PairingURLParser.parseURL(
                "graft://pair?v=1&host=\(host)&label=\(String(repeating: "a", count: 121))#token=\(token)"
            )
        )
    }

    func testPairingURLRejectsUnsupportedEndpointKind() {
        let raw = "graft://pair?v=1&host=http%3A%2F%2F127.0.0.1%3A4783&endpointKind=wan#token=abcdefghijklmnop"
        XCTAssertNil(PairingURLParser.parseURL(raw))
    }

    func testValidPairingJSON() throws {
        let json = """
        {"v":1,"host":"http://100.64.0.12:4783","token":"abcdefghijklmnopqrstuv","label":"Studio","endpointKind":"tailnet"}
        """
        let payload = try XCTUnwrap(PairingURLParser.parse(json))

        XCTAssertEqual(payload.v, 1)
        XCTAssertEqual(payload.host, "http://100.64.0.12:4783")
        XCTAssertEqual(payload.token, "abcdefghijklmnopqrstuv")
        XCTAssertEqual(payload.label, "Studio")
        XCTAssertEqual(payload.endpointKind, "tailnet")
    }

    func testPairingJSONFromFixture() throws {
        let data = try loadFixture("pairing-payload.json")
        let payload = try JSONDecoder().decode(PairingPayload.self, from: data)
        let parsedPayload = try XCTUnwrap(PairingURLParser.parse(String(decoding: data, as: UTF8.self)))

        XCTAssertEqual(payload.v, 1)
        XCTAssertEqual(payload.host, "http://100.64.0.12:4783")
        XCTAssertFalse(payload.token.isEmpty)
        XCTAssertEqual(parsedPayload, payload)
    }

    func testPairingJSONRejectsInvalidFields() {
        XCTAssertNil(
            PairingURLParser.parse(
                #"{"v":0,"host":"http://127.0.0.1:4783","token":"abcdefghijklmnop"}"#
            )
        )
        XCTAssertNil(
            PairingURLParser.parse(
                #"{"v":1,"host":"http://127.0.0.1:4783","token":"bad token with spaces"}"#
            )
        )
        XCTAssertNil(
            PairingURLParser.parse(
                #"{"v":1,"host":"ws://127.0.0.1:4783","token":"abcdefghijklmnop"}"#
            )
        )
        XCTAssertNil(
            PairingURLParser.parse(
                #"{"v":1,"host":"http://127.0.0.1:4783","token":"abcdefghijklmnop","label":"","endpointKind":"tailnet"}"#
            )
        )
        XCTAssertNil(
            PairingURLParser.parse(
                #"{"v":1,"host":"http://127.0.0.1:4783","token":"abcdefghijklmnop","endpointKind":"bluetooth"}"#
            )
        )
    }

    func testInvalidJSON() {
        XCTAssertNil(PairingURLParser.parse("not json at all"))
    }
}
