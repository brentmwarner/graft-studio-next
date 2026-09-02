import SwiftUI

/// Graft dot-matrix loader + live status phrase. The loader stays put; the next phrase sits in
/// place and is wiped on from the leading edge. No elapsed timer — the
/// copy itself is the signal.
struct LiveStatusLine: View {
    let phrase: String
    var canReveal = false
    var revealed = false
    var tools: [ToolPresentation] = []
    var onTap: () -> Void = {}

    var body: some View {
        Group {
            if canReveal {
                Button(action: onTap) {
                    LiveStatusRow(phrase: phrase, revealed: revealed, canReveal: true, tools: tools)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
            } else {
                LiveStatusRow(phrase: phrase, revealed: revealed, canReveal: false, tools: tools)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(phrase)
        .accessibilityAddTraits(canReveal ? .isButton : [])
        .accessibilityHint(canReveal ? "Shows the work so far" : "")
    }
}

private struct LiveStatusRow: View {
    let phrase: String
    var revealed = false
    var canReveal = false
    var tools: [ToolPresentation] = []

    var body: some View {
        HStack(spacing: 10) {
            RunStatusDotMatrixLoader(size: 18, tint: DS.Color.fgSubtle)
            ZStack(alignment: .leading) {
                LiveStatusPhraseLabel(phrase: phrase)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .clipped()
            .layoutPriority(1)
            if canReveal {
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(DS.Color.fgSubtle)
                    .rotationEffect(.degrees(revealed ? 90 : 0))
            }
            if !tools.isEmpty {
                BrandCircleStack(presentations: tools)
                    .transition(.scale(scale: 0.6).combined(with: .opacity))
            }
        }
    }
}

/// Isolated so a phrase swap only invalidates the label, not the orb.
/// Reduce Motion keeps a short opacity crossfade and skips the wipe.
private struct LiveStatusPhraseLabel: View {
    let phrase: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var displayed: String
    @State private var outgoing = ""
    @State private var wipe: CGFloat = 0
    @State private var outgoingOpacity: CGFloat = 0
    @State private var incomingOpacity: CGFloat = 1

    init(phrase: String) {
        self.phrase = phrase
        _displayed = State(initialValue: phrase)
    }

    var body: some View {
        ZStack(alignment: .leading) {
            if outgoingOpacity > 0.01 {
                ShimmerText(text: outgoing, font: .subheadline.weight(.medium))
                    .lineLimit(1)
                    .opacity(outgoingOpacity)
                    .allowsHitTesting(false)
            }
            ShimmerText(text: displayed, font: .subheadline.weight(.medium))
                .lineLimit(1)
                .opacity(incomingOpacity)
                .mask(alignment: .leading) {
                    SoftLeadingWipe(progress: wipe)
                }
        }
        .onAppear { reveal(phrase) }
        .onChange(of: phrase) { _, next in
            reveal(next)
        }
    }

    private func reveal(_ next: String) {
        let same = displayed == next
        var reset = Transaction()
        reset.disablesAnimations = true
        withTransaction(reset) {
            outgoing = same || !reduceMotion ? "" : displayed
            outgoingOpacity = outgoing.isEmpty ? 0 : 1
            displayed = next
            if reduceMotion {
                wipe = 1
                incomingOpacity = outgoing.isEmpty ? 1 : 0
            } else {
                incomingOpacity = 1
                wipe = 0
            }
        }
        if reduceMotion {
            withAnimation(.easeOut(duration: 0.22)) {
                incomingOpacity = 1
                outgoingOpacity = 0
            }
            return
        }
        withAnimation(.smooth(duration: 0.32)) {
            wipe = 1
            outgoingOpacity = 0
        }
    }
}

/// Soft-edged leading wipe. Glyphs stay put; a feathered mask travels
/// left to right so letters are uncovered instead of sliced.
private struct SoftLeadingWipe: View, Animatable {
    var progress: CGFloat
    var feather: CGFloat = 36

    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    var body: some View {
        GeometryReader { geo in
            let width = max(geo.size.width, 1)
            let span = width + feather
            let travel = min(max(progress, 0), 1) * span
            LinearGradient(
                stops: [
                    .init(color: .white, location: 0),
                    .init(color: .white, location: max(0, 1 - feather / span)),
                    .init(color: .clear, location: 1),
                ],
                startPoint: .leading,
                endPoint: .trailing
            )
            .frame(width: span, height: geo.size.height)
            .offset(x: travel - span)
        }
    }
}

#if DEBUG
/// Launch with `--live-status-demo` to record the live header without a host.
struct LiveStatusDemoView: View {
    @State private var step = 0

    private let script: [(phrase: String, tools: [ToolPresentation])] = [
        (LiveStatusPhrase.thinking, []),
        ("Reading files", [ToolPresentation(name: "read", context: "LiveStatusLine.swift")]),
        (
            "Running a command",
            [
                ToolPresentation(name: "read", context: "LiveStatusLine.swift"),
                ToolPresentation(name: "bash", context: "pnpm test"),
            ]
        ),
        (
            "Searching the web",
            [
                ToolPresentation(name: "read", context: "LiveStatusLine.swift"),
                ToolPresentation(name: "bash", context: "pnpm test"),
                ToolPresentation(name: "web_search", context: "https://developer.apple.com"),
            ]
        ),
        (
            "Editing a file",
            [
                ToolPresentation(name: "read", context: "LiveStatusLine.swift"),
                ToolPresentation(name: "bash", context: "pnpm test"),
                ToolPresentation(name: "write", context: "ToolActivityStrip.swift"),
            ]
        ),
        (
            LiveStatusPhrase.thinking,
            [
                ToolPresentation(name: "read", context: "LiveStatusLine.swift"),
                ToolPresentation(name: "bash", context: "pnpm test"),
                ToolPresentation(name: "write", context: "ToolActivityStrip.swift"),
            ]
        ),
    ]

    var body: some View {
        let current = script[step % script.count]
        VStack(alignment: .leading, spacing: 18) {
            Spacer()
            HStack {
                Spacer(minLength: 56)
                Text("Tighten the thinking header — orb plus the action, no timer.")
                    .font(DS.Font.body)
                    .foregroundStyle(DS.Color.fg)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 11)
                    .background(DS.Color.bubbleFill, in: .rect(cornerRadius: DS.Radius.bubble))
            }
            LiveStatusLine(phrase: current.phrase, tools: current.tools)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 48)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .background(DS.Color.bg)
        .preferredColorScheme(.dark)
        .task { await play() }
    }

    private func play() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .milliseconds(step == 0 ? 1600 : 2000))
            guard !Task.isCancelled else { return }
            withAnimation(.smooth(duration: 0.32)) {
                step += 1
            }
        }
    }
}

#Preview("Live status") {
    LiveStatusDemoView()
}
#endif
