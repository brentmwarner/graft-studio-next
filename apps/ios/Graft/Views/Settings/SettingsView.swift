import SwiftUI

/// App settings reached from the nav drawer: pairing, account, and app info.
struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var showPairing = false

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
                    ForEach(computers, id: \.environmentId) { computer in
                        let isActive = computer.environmentId == app.connection.session?.environmentId
                        Button {
                            app.activateSession(computer.environmentId)
                        } label: {
                            LabeledContent {
                                HStack(spacing: 6) {
                                    Circle()
                                        .fill(
                                            isActive && app.gateway.state == .connected
                                                ? Color.green : Color.secondary
                                        )
                                        .frame(width: 7, height: 7)
                                    Text(verbatim: computerLabel(computer))
                                }
                            } label: {
                                Text(isActive ? "Studio" : computerLabel(computer),
                                     comment: "Paired desktop row label")
                            }
                        }
                        .disabled(isActive)
                        .foregroundStyle(.primary)

                        Button(role: .destructive) {
                            Task {
                                await app.unpair(computer.environmentId)
                                if !app.isPaired { dismiss() }
                            }
                        } label: {
                            Text(
                                computers.count > 1
                                    ? "Disconnect \(computerLabel(computer))"
                                    : "Disconnect",
                                comment: "Unpair from the desktop"
                            )
                        }
                    }

                    Button {
                        showPairing = true
                    } label: {
                        Text("Pair another computer", comment: "Add another Studio pairing")
                    }
                } header: {
                    PlainHeader("Connection")
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
            .sheet(isPresented: $showPairing) {
                PairingView(isPresented: $showPairing)
            }
        }
    }

    private var computers: [PersistedSession] {
        let stored = app.connection.sessions
        if stored.isEmpty, let session = app.connection.session {
            return [session]
        }
        return stored
    }

    private func computerLabel(_ session: PersistedSession) -> String {
        session.environmentLabel.isEmpty ? "Studio" : session.environmentLabel
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
}
