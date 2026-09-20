import SwiftUI

/// Top-level view that switches between onboarding and home, and owns deep links.
/// Adaptive iPad chrome (split sidebar + chat) lives in `HomeView`; this root
/// still only gates Welcome vs the paired home surface.
struct RootView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Group {
            #if DEBUG
            if Self.isLiveStatusDemo {
                LiveStatusDemoView()
            } else if app.isPaired {
                HomeView()
            } else {
                WelcomeView()
            }
            #else
            if app.isPaired {
                HomeView()
            } else {
                WelcomeView()
            }
            #endif
        }
        .scenePhaseSync(app: app)
        .task(id: app.connection.session?.sessionId) {
            guard app.isPaired else { return }
            app.reconnectIfNeeded()
            PushRegistrar.shared.configure(connectionStore: app.connection)
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
            Task { await app.pair(with: payload) }
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
    let app: AppModel
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content
            .onChange(of: scenePhase) { _, newPhase in
                app.scenePhaseChanged(newPhase)
            }
    }
}

private extension View {
    func scenePhaseSync(app: AppModel) -> some View {
        modifier(ScenePhaseSyncModifier(app: app))
    }
}

#Preview {
    RootView()
        .environment(AppModel())
}
