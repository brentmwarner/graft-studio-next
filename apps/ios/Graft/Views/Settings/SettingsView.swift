import SwiftUI

/// App settings reached from the nav drawer: pairing, account, and app info.
struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent {
                        HStack(spacing: 6) {
                            Circle()
                                .fill(
                                    app.gateway.state == .connected
                                        ? Color.green : Color.secondary
                                )
                                .frame(width: 7, height: 7)
                            Text(verbatim: hostLabel)
                        }
                    } label: {
                        Text("Studio", comment: "Paired desktop row label")
                    }

                    Button(role: .destructive) {
                        Task { await app.unpair() }
                        dismiss()
                    } label: {
                        Text("Disconnect", comment: "Unpair from the desktop")
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
}
