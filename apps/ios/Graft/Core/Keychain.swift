import Foundation
import Security

/// Generic-password Keychain wrapper for storing the session bearer token.
///
/// All values are accessible after first device unlock and are not migrated to
/// new devices (`.afterFirstUnlockThisDeviceOnly`), which is appropriate for
/// session credentials that must be re-established after a device restore.
enum Keychain {
    private static let service = "studio.graft.mobile"

    /// Reads a UTF-8 string stored under `account`, or `nil` if absent.
    static func string(for account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String:       kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String:  true,
            kSecMatchLimit as String:  kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Stores `value` for `account`, overwriting any existing entry.
    /// Passing `nil` or an empty string deletes the entry.
    @discardableResult
    static func set(_ value: String?, for account: String) -> Bool {
        let base: [String: Any] = [
            kSecClass as String:       kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let deleteStatus = SecItemDelete(base as CFDictionary)
        guard deleteStatus == errSecSuccess || deleteStatus == errSecItemNotFound else {
            AppLog.persistence.error("Keychain replacement failed for '\(account)': \(deleteStatus)")
            return false
        }
        guard let value, !value.isEmpty, let data = value.data(using: .utf8) else { return true }
        var attributes = base
        attributes[kSecValueData as String]    = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(attributes as CFDictionary, nil)
        if status != errSecSuccess {
            AppLog.persistence.error("Keychain write failed for '\(account)': \(status)")
            return false
        }
        return true
    }

    /// Removes the entry for `account` (no-op if it doesn't exist).
    static func delete(for account: String) {
        let query: [String: Any] = [
            kSecClass as String:       kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

// MARK: - Named accounts

extension Keychain {
    /// The bearer token returned by the host after pairing.
    static let bearerTokenAccount = "bearerToken"
}
