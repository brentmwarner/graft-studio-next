import SwiftUI

/// App settings reached from the nav drawer: pairing, account, and app info.
struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(MachineStore.self) private var machines
    @State private var showPairing = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        @Bindable var settings = app.settings
        NavigationStack {
            List {
                Section {
                    Toggle("Response haptics", isOn: $settings.streamingHaptics)
                } header: {
                    PlainHeader("Chat")
                } footer: {
                    Text("A few soft taps while streaming, with a confirmation when the final response is ready.")
                }

                Section {
                    ForEach(machines.machines) { machine in
                        HStack {
                            Circle().fill(machine.gateway.state == .connected ? Color.green : Color.red)
                                .frame(width: 7, height: 7)
                            Text(verbatim: machine.environmentLabel)
                            Spacer()
                            Button("Remove", role: .destructive) {
                                Task { await machines.remove(machine) }
                            }
                            .accessibilityLabel("Remove \(machine.environmentLabel)")
                        }
                    }
                    Button("Add computer", systemImage: "plus") { showPairing = true }
                } header: {
                    PlainHeader("Computers")
                }

                if app.auth.isSignedIn, let email = app.auth.email {
                    Section {
                        LabeledContent {
                            Text(verbatim: email)
                        } label: {
                            Text("Email", comment: "Account email row label")
                        }

                        Button(role: .destructive) {
                            app.auth.signOut()
                        } label: {
                            Text("Sign out", comment: "Sign out of the Graft account")
                        }
                    } header: {
                        PlainHeader("Account")
                    }
                }

                Section {
                    LabeledContent {
                        Text(verbatim: appVersion)
                    } label: {
                        Text("Version", comment: "App version row label")
                    }
                } header: {
                    PlainHeader("About")
                }
            }
            .listStyle(.insetGrouped)
            .drawerSurface()
            .sheet(isPresented: $showPairing) {
                PairingView(isPresented: $showPairing).environment(machines.pairingApp)
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        dismiss()
                    } label: {
                        Text("Done", comment: "Dismiss settings")
                    }
                }
            }
        }
    }

    private var hostLabel: String {
        if let label = app.connection.session?.environmentLabel, !label.isEmpty {
            return label
        }
        return "Studio"
    }

    private var appVersion: String {
        let version = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleShortVersionString"
        ) as? String ?? "—"
        let build = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleVersion"
        ) as? String
        return build.map { "\(version) (\($0))" } ?? version
    }
}

#Preview {
    SettingsView()
        .environment(AppModel())
        .environment(MachineStore())
}
