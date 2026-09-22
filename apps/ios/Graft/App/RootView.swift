import SwiftUI

/// Top-level view that switches between onboarding and home, and owns deep links.
/// Adaptive iPad chrome (split sidebar + chat) lives in `HomeView`; this root
/// still only gates Welcome vs the paired home surface.
struct RootView: View {
    @Environment(MachineStore.self) private var machines
    @Environment(AppModel.self) private var app

    var body: some View {
        Group {
            #if DEBUG
            if Self.isLiveStatusDemo {
                LiveStatusDemoView()
            } else if !machines.machines.isEmpty {
                HomeView()
                    .environment(machines.machines.first ?? app)
            } else {
                WelcomeView()
            }
            #else
            if !machines.machines.isEmpty {
                HomeView()
                    .environment(machines.machines.first ?? app)
            } else {
                WelcomeView()
            }
            #endif
        }
        .scenePhaseSync(machines: machines)
        .task(id: app.connection.session?.sessionId) {
            machines.reload()
        }
        .task(id: machines.machines.map(\.sessionIdentity)) {
            guard let machine = machines.machines.first else { return }
            PushRegistrar.shared.configure(connectionStore: machine.connection)
            await PushRegistrar.shared.enableAndRegister()
        }
        .onOpenURL { url in
            handleDeepLink(url)
        }
    }

    private func handleDeepLink(_ url: URL) {
        guard url.scheme == "graft" else { return }
        switch url.host {
        case "pair":
            guard let payload = PairingURLParser.parse(url.absoluteString) else {
                AppLog.pairing.warning("Malformed pairing deep link")
                return
            }
            AppLog.pairing.info("Received pairing deep link for host \(safeHost(payload.host))")
            Task { await app.connection.pair(with: payload) }
        default:
            AppLog.ui.warning("Unhandled graft deep link route: \(url.host ?? "missing-host")")
        }
    }

    private func safeHost(_ rawHost: String) -> String {
        URLComponents(string: rawHost)?.host ?? "unknown"
    }

    private static var isLiveStatusDemo: Bool {
        #if DEBUG
        CommandLine.arguments.contains("--live-status-demo")
        #else
        false
        #endif
    }
}

/// Isolates `scenePhase` observation so pairing/home bodies are not invalidated by it.
private struct ScenePhaseSyncModifier: ViewModifier {
    let machines: MachineStore
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content
            .onChange(of: scenePhase) { _, newPhase in
                machines.scenePhaseChanged(newPhase)
            }
    }
}

private extension View {
    func scenePhaseSync(machines: MachineStore) -> some View {
        modifier(ScenePhaseSyncModifier(machines: machines))
    }
}

#Preview {
    RootView()
        .environment(AppModel())
        .environment(MachineStore())
}
