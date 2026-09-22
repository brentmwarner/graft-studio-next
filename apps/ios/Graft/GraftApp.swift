import SwiftUI

@main
struct GraftApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var machines = MachineStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(machines)
                .environment(machines.pairingApp)
        }
    }
}
