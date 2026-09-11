import XCTest
@testable import Graft

/// The control-plane validates every auth token shape strictly
/// (`OPAQUE_TOKEN_PATTERN`, `derivePkceChallenge`); these tests pin the
/// client-side derivations to those contracts.
@MainActor
final class AuthStoreTests: XCTestCase {

    func testRandomTokenMatchesOpaqueTokenShape() {
        for _ in 0..<8 {
            let token = AuthStore.randomToken()
            XCTAssertNotNil(
                token.wholeMatch(of: /[A-Za-z0-9_-]{43}/),
                "\(token) must be 43 chars of base64url"
            )
        }
    }

    func testRandomTokensAreUnique() {
        let tokens = Set((0..<8).map { _ in AuthStore.randomToken() })
        XCTAssertEqual(tokens.count, 8)
    }

    func testPkceChallengeMatchesRfc7636TestVector() {
        // RFC 7636 Appendix B: the canonical S256 verifier/challenge pair.
        let challenge = AuthStore.pkceChallenge(
            for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        )
        XCTAssertEqual(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }
}
