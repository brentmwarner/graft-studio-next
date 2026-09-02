import AVKit
import SwiftUI

/// Inline video in the transcript: a compact poster thumbnail at the same
/// register as image thumbnails (one size, like any messaging app), with a
/// play badge — tap to play full-screen with system controls.
struct ChatVideoView: View {
    @Environment(AppModel.self) private var app
    let video: ChatVideo

    @State private var showPlayer = false

    /// Same compact register as assistant image attachments.
    private let tileSize = CGSize(width: 142, height: 104)

    var body: some View {
        Group {
            if video.fileURL != nil {
                Button {
                    showPlayer = true
                } label: {
                    ZStack {
                        if let poster = video.poster {
                            Image(uiImage: poster)
                                .resizable()
                                .scaledToFill()
                        } else {
                            DS.Color.bgSubtle
                        }
                        Image(systemName: "play.fill")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 40, height: 40)
                            .background(.black.opacity(0.45), in: .circle)
                    }
                    .frame(width: tileSize.width, height: tileSize.height)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
            } else if video.failed {
                Button {
                    Task { await video.retry(rest: app.rest) }
                } label: {
                    Label("Video unavailable — retry", systemImage: "arrow.clockwise")
                        .font(DS.Font.caption)
                        .foregroundStyle(DS.Color.fgSubtle)
                        .frame(width: tileSize.width, height: tileSize.height)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .background(DS.Color.bgSubtle)
            } else {
                ZStack {
                    DS.Color.bgSubtle
                    ProgressView()
                }
                .frame(width: tileSize.width, height: tileSize.height)
            }
        }
        .clipShape(.rect(cornerRadius: DS.Radius.md, style: .continuous))
        .task { await video.load(rest: app.rest) }
        .fullScreenCover(isPresented: $showPlayer) {
            if let url = video.fileURL {
                VideoLightbox(url: url)
            }
        }
        .accessibilityLabel("Video attachment")
    }
}

/// Full-screen playback with system controls, auto-playing on entry — the
/// video counterpart of the system image previewer.
private struct VideoLightbox: View {
    @Environment(\.dismiss) private var dismiss
    let url: URL

    @State private var player: AVPlayer?

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.ignoresSafeArea()
            VideoPlayer(player: player)
                .ignoresSafeArea()
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 38, height: 38)
                    .background(.black.opacity(0.5), in: .circle)
            }
            .buttonStyle(.plain)
            .padding(.leading, 16)
            .padding(.top, 8)
        }
        .onAppear {
            let fresh = AVPlayer(url: url)
            player = fresh
            fresh.play()
        }
        .onDisappear {
            player?.pause()
        }
    }
}
