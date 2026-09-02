import OSLog

/// Centralised logging subsystem for Graft.
///
/// Usage:
/// ```swift
/// AppLog.networking.info("Connected to \(url)")
/// AppLog.pairing.error("Bad token: \(err)")
/// ```
enum AppLog {
    static let networking = Logger(subsystem: "studio.graft.mobile", category: "networking")
    static let pairing    = Logger(subsystem: "studio.graft.mobile", category: "pairing")
    static let persistence = Logger(subsystem: "studio.graft.mobile", category: "persistence")
    static let push       = Logger(subsystem: "studio.graft.mobile", category: "push")
    static let ui         = Logger(subsystem: "studio.graft.mobile", category: "ui")
}
