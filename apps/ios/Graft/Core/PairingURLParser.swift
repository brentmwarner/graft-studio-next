import Foundation

/// Shared parser for `graft://pair?v=1&host=…#token=…` deep links and paste input.
enum PairingURLParser {
    private static let supportedEndpointKinds: Set<String> = [
        "loopback",
        "lan",
        "tailnet",
        "https",
        "relay"
    ]
    private static let tokenPattern = #"^[A-Za-z0-9._~-]{16,256}$"#

    static func parse(_ raw: String) -> PairingPayload? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if let payload = parseURL(trimmed) { return payload }
        return parseJSON(trimmed)
    }

    static func parseURL(_ raw: String) -> PairingPayload? {
        guard let components = URLComponents(string: raw),
              components.scheme == "graft",
              components.host == "pair"
        else { return nil }

        let queryItems = components.queryItems ?? []
        guard let vStr = queryItems.first(where: { $0.name == "v" })?.value,
              let v = Int(vStr),
              let host = queryItems.first(where: { $0.name == "host" })?.value,
              !host.isEmpty
        else { return nil }

        var token = ""
        if let fragment = components.fragment {
            for pair in fragment.split(separator: "&") {
                let kv = pair.split(separator: "=", maxSplits: 1)
                if kv.count == 2, kv[0] == "token" {
                    token = String(kv[1]).removingPercentEncoding ?? String(kv[1])
                }
            }
        }

        let rawLabel = queryItems.first(where: { $0.name == "label" })?.value
        let label = rawLabel?.replacingOccurrences(of: "+", with: " ")
        let endpointKind = queryItems.first(where: { $0.name == "endpointKind" })?.value

        return validate(
            PairingPayload(
                v: v,
                host: host,
                token: token,
                label: label,
                endpointKind: endpointKind
            )
        )
    }

    private static func parseJSON(_ raw: String) -> PairingPayload? {
        guard let data = raw.data(using: .utf8),
              let payload = try? JSONDecoder().decode(PairingPayload.self, from: data)
        else { return nil }
        return validate(payload)
    }

    private static func validate(_ payload: PairingPayload) -> PairingPayload? {
        guard payload.v == 1,
              isSupportedHost(payload.host),
              isSupportedToken(payload.token),
              isSupportedLabel(payload.label),
              isSupportedEndpointKind(payload.endpointKind)
        else { return nil }

        return PairingPayload(
            v: payload.v,
            host: payload.host,
            token: payload.token,
            label: payload.label,
            endpointKind: payload.endpointKind
        )
    }

    private static func isSupportedHost(_ rawHost: String) -> Bool {
        guard let components = URLComponents(string: rawHost),
              let scheme = components.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              let host = components.host,
              !host.isEmpty
        else { return false }
        return components.url?.scheme != nil
    }

    private static func isSupportedToken(_ token: String) -> Bool {
        token.range(of: tokenPattern, options: .regularExpression) != nil
    }

    private static func isSupportedLabel(_ label: String?) -> Bool {
        guard let label else { return true }
        let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && trimmed.count <= 120
    }

    private static func isSupportedEndpointKind(_ endpointKind: String?) -> Bool {
        guard let endpointKind else { return true }
        return supportedEndpointKinds.contains(endpointKind)
    }
}
