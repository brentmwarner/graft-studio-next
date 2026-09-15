import SwiftUI

/// Pairing flow for pasted or scanned `graft://pair?…` URLs.
struct PairingView: View {
    @Binding var isPresented: Bool
    @Environment(AppModel.self) private var app

    @State private var input = ""
    @State private var errorMessage: String?
    @State private var isLoading = false
    @State private var isScannerPresented = false
    @State private var scannerMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.s3) {
                    PairingQRSection(
                        isLoading: isLoading,
                        openScanner: {
                            scannerMessage = nil
                            isScannerPresented = true
                        }
                    )
                    PairingLinkSection(input: $input)
                    if let errorMessage {
                        PairingErrorNotice(message: errorMessage)
                    }
                }
                .padding(.horizontal, DS.Space.s2)
                .padding(.top, DS.Space.s2)
                .padding(.bottom, DS.Space.s4)
            }
            .drawerSurface()
            .navigationTitle("Pair with Graft Studio")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        isPresented = false
                    } label: {
                        Text("Cancel", comment: "Dismiss pairing sheet")
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        submitPairing()
                    } label: {
                        Text("Pair", comment: "Submit pasted pairing link")
                    }
                    .disabled(
                        input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            || isLoading
                    )
                }
            }
            .overlay {
                if isLoading {
                    ProgressView("Pairing…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(.ultraThinMaterial)
                }
            }
            .pairingConnectionSync(
                connection: app.connection,
                isLoading: $isLoading,
                errorMessage: $errorMessage,
                isPresented: $isPresented
            )
            .sheet(isPresented: $isScannerPresented) {
                QRScannerView(
                    message: scannerMessage,
                    onScannedCode: submitScannedPairing,
                    onDismiss: { isScannerPresented = false }
                )
            }
        }
    }

    private func submitPairing() {
        _ = submitRawPairingInput(
            input,
            invalidMessage: String(
                localized: "Couldn't parse the pairing link. Make sure you copied the full link."
            )
        )
    }

    private func submitScannedPairing(_ rawInput: String) -> Bool {
        submitRawPairingInput(
            rawInput,
            invalidMessage: String(
                localized: "That QR code is not a valid Graft pairing code. Keep the scanner open and try another code."
            ),
            onValidPayload: {
                scannerMessage = nil
                isScannerPresented = false
            },
            onInvalidPayload: { message in
                scannerMessage = message
            }
        )
    }

    @discardableResult
    private func submitRawPairingInput(
        _ rawInput: String,
        invalidMessage: String,
        onValidPayload: () -> Void = {},
        onInvalidPayload: (String) -> Void = { _ in }
    ) -> Bool {
        errorMessage = nil
        let trimmed = rawInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let payload = PairingURLParser.parse(trimmed) else {
            errorMessage = invalidMessage
            onInvalidPayload(invalidMessage)
            return false
        }
        onValidPayload()
        Task { await app.connection.pair(with: payload) }
        return true
    }
}

// MARK: - Sections

struct PairingLinkSection: View {
    @Binding var input: String

    var body: some View {
        DSFormGroup(
            "Or paste the link",
            footer: "Paste the link from Graft Studio → Settings → Mobile Pairing."
        ) {
            TextEditor(text: $input)
                .frame(minHeight: 96)
                .font(.callout.monospaced())
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .scrollContentBackground(.hidden)
                .padding(.horizontal, DS.Space.s1)
                .padding(.vertical, DS.Space.half)
                .dsInputBox()
                .accessibilityLabel(
                    Text(
                        "Pairing link",
                        comment: "Accessibility label for pairing URL editor"
                    )
                )
        }
    }
}

struct PairingErrorNotice: View {
    let message: String

    var body: some View {
        DSCard {
            DSControlRow {
                Label(message, systemImage: "exclamationmark.triangle")
                    .font(DS.Font.footnote)
                    .foregroundStyle(DS.Color.danger)
                    .padding(.vertical, DS.Space.s1)
            }
        }
    }
}

struct PairingQRSection: View {
    let isLoading: Bool
    let openScanner: () -> Void

    var body: some View {
        DSFormGroup(
            footer: "Scan the QR code from Graft Studio → Settings → Mobile Pairing."
        ) {
            Button(action: openScanner) {
                HStack(spacing: DS.Space.s1 + 2) {
                    Image(systemName: "qrcode.viewfinder")
                        .font(.system(size: 19, weight: .medium))
                    Text("Scan QR code")
                        .font(.system(size: 16.5, weight: .semibold))
                        .tracking(-0.3)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .foregroundStyle(DS.Color.accentFg)
                .background(DS.Color.accent, in: .rect(cornerRadius: DS.Radius.md))
                .contentShape(.rect(cornerRadius: DS.Radius.md))
            }
            .buttonStyle(.plain)
            .disabled(isLoading)
            .opacity(isLoading ? 0.5 : 1)
            .accessibilityHint(
                Text(
                    "Opens the camera scanner for a Graft pairing QR code",
                    comment: "Accessibility hint for QR pairing button"
                )
            )
        }
    }
}

// MARK: - Side-effect isolation

/// Isolates pairing connection observation so Form body invalidation stays narrow.
private struct PairingConnectionSyncModifier: ViewModifier {
    let connection: ConnectionStore
    @Binding var isLoading: Bool
    @Binding var errorMessage: String?
    @Binding var isPresented: Bool

    func body(content: Content) -> some View {
        content
            .onChange(of: connection.isPairing) { _, newValue in
                isLoading = newValue
            }
            .onChange(of: connection.pairingError) { _, newError in
                if let newError {
                    errorMessage = pairingErrorMessage(newError)
                }
            }
            .onChange(of: connection.isPaired) { _, isPaired in
                if isPaired { isPresented = false }
            }
    }
}

private extension View {
    func pairingConnectionSync(
        connection: ConnectionStore,
        isLoading: Binding<Bool>,
        errorMessage: Binding<String?>,
        isPresented: Binding<Bool>
    ) -> some View {
        modifier(
            PairingConnectionSyncModifier(
                connection: connection,
                isLoading: isLoading,
                errorMessage: errorMessage,
                isPresented: isPresented
            )
        )
    }
}

private func pairingErrorMessage(_ error: GraftError) -> String {
    switch error {
    case .unauthorized:
        return String(
            localized: "Pairing token was rejected. Make sure the link is fresh."
        )
    case .unreachable(let detail):
        return String(localized: "Couldn't reach this computer: \(detail)")
    case .malformedPairingURL(let detail):
        return detail
    case .hostError(_, let message, _):
        return message
    default:
        return error.localizedDescription
    }
}

#Preview {
    PairingView(isPresented: .constant(true))
        .environment(AppModel())
}
