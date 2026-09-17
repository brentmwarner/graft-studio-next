import SwiftUI

/// A compact trigger; the dock owns the disclosure so its content overlays the
/// transcript without changing the keyboard or composer's position.
struct TaskProgressPill: View {
    let progress: TaskProgress
    let expanded: Bool
    let onToggle: () -> Void

    var body: some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            onToggle()
        } label: {
            HStack(spacing: 9) {
                Image(systemName: progress.isComplete ? "checkmark.circle.fill" : "checklist")
                    .font(.system(size: 16, weight: .medium))
                Text("Tasks")
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                Text("\(progress.completedCount)/\(progress.items.count)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(DS.Color.fgSubtle)
                Image(systemName: "chevron.up")
                    .font(.system(size: 11, weight: .semibold))
                    .rotationEffect(.degrees(expanded ? 180 : 0))
                    .foregroundStyle(DS.Color.fgSubtle)
            }
            .foregroundStyle(DS.Color.fgMuted)
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .composerGlassSurface(shape: .capsule, interactive: true)
        .accessibilityLabel("\(progress.title), \(progress.completedCount) of \(progress.items.count) completed")
        .accessibilityValue(expanded ? "Expanded" : "Collapsed")
        .accessibilityHint(expanded ? "Hide task details" : "Show task details")
        .accessibilityIdentifier("task-progress-toggle")
    }
}

struct TaskProgressDetails: View {
    let progress: TaskProgress

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if progress.title != "Tasks" {
                    Text(progress.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(DS.Color.fgMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                ForEach(progress.items) { item in
                    TaskProgressRow(item: item)
                }
            }
            .padding(20)
        }
        .defaultScrollAnchor(.top)
        .frame(maxHeight: 260)
        .fixedSize(horizontal: false, vertical: true)
        .composerGlassSurface(shape: .roundedRectangle(cornerRadius: 24), interactive: false)
        .accessibilityIdentifier("task-progress-details")
    }
}

private struct TaskProgressRow: View {
    let item: TaskProgressItem

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 17))
                .foregroundStyle(item.status == .active ? DS.Color.fg : DS.Color.fgSubtle)
            .accessibilityHidden(true)
            Text(item.title)
                .font(.subheadline)
                .foregroundStyle(item.status == .done ? DS.Color.fgSubtle : DS.Color.fg)
                .strikethrough(item.status == .done)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(item.title)
        .accessibilityValue(statusLabel)
    }

    private var symbol: String {
        switch item.status {
        case .pending: "circle"
        case .active: "circle.inset.filled"
        case .done: "checkmark.circle.fill"
        }
    }

    private var statusLabel: String {
        switch item.status {
        case .pending: "Pending"
        case .active: "In progress"
        case .done: "Completed"
        }
    }
}
