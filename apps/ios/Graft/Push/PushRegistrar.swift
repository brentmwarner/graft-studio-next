import Foundation
import UIKit
import UserNotifications

enum PushRegistrationFeature {
    static let infoDictionaryKey = "GRAFT_APNS_REGISTRATION_ENABLED"

    static var isEnabled: Bool {
        isEnabled(in: Bundle.main.infoDictionary ?? [:])
    }

    static func isEnabled(in infoDictionary: [String: Any]) -> Bool {
        infoDictionary[infoDictionaryKey] as? Bool == true
    }
}

/// Owns the client half of APNs registration. Delivery remains intentionally
/// out of scope: this type only obtains a token and registers its metadata with
/// the paired desktop host when the feature flag is enabled.
@MainActor
final class PushRegistrar: NSObject {
    static let shared = PushRegistrar()

    private weak var connectionStore: ConnectionStore?

    private override init() {
        super.init()
    }

    func configure(connectionStore: ConnectionStore) {
        self.connectionStore = connectionStore
    }

    /// Requests notification permission and asks iOS for an APNs device token.
    func enableAndRegister() async {
        guard PushRegistrationFeature.isEnabled,
              connectionStore?.restClient != nil
        else { return }

        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(
                options: [.alert, .badge, .sound]
            )
            guard granted else {
                AppLog.push.info("Push notification permission was not granted")
                return
            }
            UIApplication.shared.registerForRemoteNotifications()
        } catch {
            AppLog.push.error("Push notification permission request failed")
        }
    }

    /// Removes the host-side registration before the bearer session is cleared.
    func unregisterForCurrentSession() async {
        guard PushRegistrationFeature.isEnabled else { return }

        if let client = connectionStore?.restClient {
            do {
                _ = try await client.unregisterPushRegistration()
            } catch {
                AppLog.push.error("Push registration removal failed")
            }
        }
        UIApplication.shared.unregisterForRemoteNotifications()
    }

    /// Called by `AppDelegate` when iOS supplies a token.
    func didRegisterForRemoteNotifications(with deviceToken: Data) {
        guard PushRegistrationFeature.isEnabled,
              let client = connectionStore?.restClient,
              let bundleId = Bundle.main.bundleIdentifier
        else { return }

        let token = Self.hexEncodedDeviceToken(deviceToken)
        let environment = Self.apnsEnvironment
        Task {
            do {
                _ = try await client.registerPushToken(
                    token,
                    environment: environment,
                    bundleId: bundleId
                )
                AppLog.push.info("Push registration metadata stored by host")
            } catch {
                AppLog.push.error("Push registration with host failed")
            }
        }
    }

    /// Called by `AppDelegate` when APNs registration fails.
    func didFailToRegisterForRemoteNotifications(with error: Error) {
        AppLog.push.error("APNs registration failed")
    }

    nonisolated static func hexEncodedDeviceToken(_ deviceToken: Data) -> String {
        deviceToken.map { String(format: "%02x", $0) }.joined()
    }

    static var apnsEnvironment: APNsEnvironment {
        #if DEBUG
        .sandbox
        #else
        .production
        #endif
    }
}
