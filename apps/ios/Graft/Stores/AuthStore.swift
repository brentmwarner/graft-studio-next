import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

/// Graft-account sign-in through the control-plane's WorkOS AuthKit mobile
/// flow: `ASWebAuthenticationSession` drives `/auth/mobile/login` with PKCE,
/// the callback deep-links back with a one-time grant, and
/// `/auth/mobile/exchange` swaps grant + verifier for an account JWT held in
/// the Keychain.
@MainActor
@Observable
final class AuthStore: NSObject {
    private(set) var isSignedIn = false
    private(set) var isSigningIn = false
    private(set) var email: String?
    private(set) var displayName: String?
    var lastError: String?

    /// Control-plane origin. Debug builds can point at a local server with the
    /// GRAFT_CONTROL_PLANE_URL scheme environment variable.
    static var controlPlaneBaseURL: URL {
        if let raw = ProcessInfo.processInfo.environment["GRAFT_CONTROL_PLANE_URL"],
           let url = URL(string: raw)
        {
            return url
        }
        return URL(string: "https://api.graftapp.io")!
    }

    private enum KeychainKey {
        static let token = "graft.account.jwt"
        static let email = "graft.account.email"
        static let name = "graft.account.name"
    }

    private static let callbackScheme = "graft"
    private static let flowVersion = "2"

    private var webAuthSession: ASWebAuthenticationSession?

    override init() {
        super.init()
        if let token = Keychain.string(for: KeychainKey.token), !token.isEmpty {
            isSignedIn = true
            email = Keychain.string(for: KeychainKey.email)
            displayName = Keychain.string(for: KeychainKey.name)
        }
    }

    var accountToken: String? {
        Keychain.string(for: KeychainKey.token)
    }

    // MARK: Sign in

    @discardableResult
    func signIn() async -> Bool {
        guard !isSigningIn else { return false }
        lastError = nil
        isSigningIn = true
        defer { isSigningIn = false }

        let verifier = Self.randomToken()
        let state = Self.randomToken()
        let challenge = Self.pkceChallenge(for: verifier)

        var login = URLComponents(
            url: Self.controlPlaneBaseURL.appending(path: "/auth/mobile/login"),
            resolvingAgainstBaseURL: false
        )!
        login.queryItems = [
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "flow_version", value: Self.flowVersion),
        ]

        do {
            let callback = try await presentWebAuth(url: login.url!)
            let components = URLComponents(url: callback, resolvingAgainstBaseURL: false)
            let grant = components?.queryItems?.first { $0.name == "grant" }?.value
            let echoedState = components?.queryItems?.first { $0.name == "state" }?.value
            guard let grant, !grant.isEmpty, echoedState == state else {
                throw GraftError.decoding("Sign-in callback was malformed")
            }
            let session = try await exchange(grant: grant, verifier: verifier)
            _ = Keychain.set(session.token, for: KeychainKey.token)
            _ = Keychain.set(session.email, for: KeychainKey.email)
            _ = Keychain.set(session.name, for: KeychainKey.name)
            email = session.email
            displayName = session.name
            isSignedIn = true
            return true
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            return false        // the user closed the sheet; not an error state
        } catch {
            lastError = "Sign-in failed. Please try again."
            AppLog.networking.error("Account sign-in failed: \(error)")
            return false
        }
    }

    func signOut() {
        Keychain.delete(for: KeychainKey.token)
        Keychain.delete(for: KeychainKey.email)
        Keychain.delete(for: KeychainKey.name)
        isSignedIn = false
        email = nil
        displayName = nil
    }

    // MARK: Web auth session

    private func presentWebAuth(url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: Self.callbackScheme
            ) { callbackURL, error in
                Task { @MainActor [weak self] in
                    self?.webAuthSession = nil
                    if let callbackURL {
                        continuation.resume(returning: callbackURL)
                    } else {
                        continuation.resume(
                            throwing: error ?? GraftError.decoding("Sign-in was interrupted")
                        )
                    }
                }
            }
            session.presentationContextProvider = self
            // Keep AuthKit's session cookies so returning users skip
            // re-entering credentials.
            session.prefersEphemeralWebBrowserSession = false
            webAuthSession = session
            if !session.start() {
                webAuthSession = nil
                continuation.resume(
                    throwing: GraftError.decoding("Could not present the sign-in sheet")
                )
            }
        }
    }

    // MARK: Grant exchange

    private struct ExchangeResponse: Decodable {
        let token: String
        let email: String
        let name: String?
    }

    private struct AccountSession {
        let token: String
        let email: String
        let name: String?
    }

    private func exchange(grant: String, verifier: String) async throws -> AccountSession {
        var request = URLRequest(
            url: Self.controlPlaneBaseURL.appending(path: "/auth/mobile/exchange")
        )
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONEncoder().encode([
            "grant": grant,
            "code_verifier": verifier,
            "flow_version": Self.flowVersion,
        ])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw GraftError.decoding("Sign-in exchange was rejected")
        }
        let decoded = try JSONDecoder().decode(ExchangeResponse.self, from: data)
        return AccountSession(token: decoded.token, email: decoded.email, name: decoded.name)
    }

    // MARK: Token helpers

    /// 32 random bytes, base64url — matches the control-plane's opaque-token
    /// shape (43 chars) for both the PKCE verifier and the state.
    static func randomToken() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return base64URL(Data(bytes))
    }

    /// RFC 7636 S256: base64url(SHA-256(ascii(verifier))) — must match the
    /// control-plane's `derivePkceChallenge` exactly or every exchange 401s.
    static func pkceChallenge(for verifier: String) -> String {
        base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

extension AuthStore: ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(
        for session: ASWebAuthenticationSession
    ) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
                .first { $0.isKeyWindow } ?? ASPresentationAnchor()
        }
    }
}
