import Foundation

/// Stable identity this device presents when pairing with a host.
///
/// The host uses it to recognize a returning device and replace its previous
/// registration instead of accumulating a new one per pairing exchange. The
/// identifier is minted once and kept in the Keychain so it survives app
/// reinstalls; it never leaves the device except inside pair requests.
enum DeviceIdentity {
    private static let account = "deviceIdentity"

    static var current: String {
        if let existing = Keychain.string(for: account), !existing.isEmpty {
            return existing
        }
        let minted = UUID().uuidString.lowercased()
        if !Keychain.set(minted, for: account) {
            AppLog.persistence.error("Could not persist device identity; pairing will mint a fresh one next time")
        }
        return minted
    }
}
