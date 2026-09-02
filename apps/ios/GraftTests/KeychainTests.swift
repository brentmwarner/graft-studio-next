import XCTest
@testable import Graft

/// Tests for the `Keychain` wrapper.
///
/// These tests write real Keychain entries. Each test uses a unique account
/// key prefixed with `test.` to avoid colliding with production entries.
/// All entries are cleaned up in `tearDown`.
final class KeychainTests: XCTestCase {
    private let testAccount = "test.KeychainTests.bearer"

    override func tearDown() {
        super.tearDown()
        Keychain.delete(for: testAccount)
    }

    func testSetAndReadString() {
        Keychain.set("hello-world", for: testAccount)
        XCTAssertEqual(Keychain.string(for: testAccount), "hello-world")
    }

    func testOverwriteExistingValue() {
        Keychain.set("first-value", for: testAccount)
        Keychain.set("second-value", for: testAccount)
        XCTAssertEqual(Keychain.string(for: testAccount), "second-value")
    }

    func testDeleteRemovesValue() {
        Keychain.set("to-be-deleted", for: testAccount)
        XCTAssertNotNil(Keychain.string(for: testAccount))

        Keychain.delete(for: testAccount)
        XCTAssertNil(Keychain.string(for: testAccount))
    }

    func testSetNilDeletesValue() {
        Keychain.set("initial", for: testAccount)
        Keychain.set(nil, for: testAccount)
        XCTAssertNil(Keychain.string(for: testAccount))
    }

    func testSetEmptyStringDeletesValue() {
        Keychain.set("non-empty", for: testAccount)
        Keychain.set("", for: testAccount)
        XCTAssertNil(Keychain.string(for: testAccount))
    }

    func testReadMissingReturnsNil() {
        let unique = "test.KeychainTests.nonexistent.\(UUID().uuidString)"
        XCTAssertNil(Keychain.string(for: unique))
    }

    func testDeleteMissingIsNoop() {
        let unique = "test.KeychainTests.noop.\(UUID().uuidString)"
        // Should not crash
        Keychain.delete(for: unique)
    }

    func testDistinctAccountsAreSeparate() {
        let accountA = "test.KeychainTests.a"
        let accountB = "test.KeychainTests.b"
        defer {
            Keychain.delete(for: accountA)
            Keychain.delete(for: accountB)
        }

        Keychain.set("value-a", for: accountA)
        Keychain.set("value-b", for: accountB)

        XCTAssertEqual(Keychain.string(for: accountA), "value-a")
        XCTAssertEqual(Keychain.string(for: accountB), "value-b")
    }

    func testStoreLongToken() {
        // Simulate a realistic bearer token (32 hex bytes = 64 chars)
        let token = String(repeating: "a", count: 64)
        Keychain.set(token, for: testAccount)
        XCTAssertEqual(Keychain.string(for: testAccount), token)
    }
}
