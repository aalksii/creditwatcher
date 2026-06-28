import SwiftUI

struct ProviderCardView: View {
    let provider: QuotaProvider

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            content
        }
        .padding(12)
        .background(Color(nsColor: .controlBackgroundColor).opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
    }

    @ViewBuilder
    private var header: some View {
        HStack {
            Text(provider.displayName)
                .font(.headline)
            if let plan = provider.plan {
                Text("(\(plan))")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if provider.cached == true {
                Text("cached")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch provider.status {
        case "not_connected":
            Text(provider.loginHint ?? "Not connected")
                .font(.caption)
                .foregroundStyle(.secondary)
        case "cooldown":
            if provider.windows.isEmpty {
                Text(provider.error ?? "On cooldown")
                    .font(.caption)
                    .foregroundStyle(.orange)
            } else {
                windowRows
                if let seconds = provider.secondsUntilRefresh {
                    Text("Refresh in \(formatDuration(seconds: seconds))")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                }
            }
        case "error":
            if !provider.windows.isEmpty {
                windowRows
            }
            Text(provider.error ?? "Error fetching usage")
                .font(.caption)
                .foregroundStyle(.red)
        default:
            windowRows
            if let credits = provider.credits?.balance {
                Text("Credits: \(credits)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            ForEach(provider.warnings, id: \.self) { warning in
                Text(warning)
                    .font(.caption2)
                    .foregroundStyle(.orange)
            }
        }
    }

    @ViewBuilder
    private var windowRows: some View {
        ForEach(provider.windows) { window in
            HStack(spacing: 8) {
                Text(shortWindowLabel(window.label))
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .frame(width: 28, alignment: .leading)

                ProgressView(value: min(max(window.usedPercent, 0), 100), total: 100)
                    .tint(percentColor(window.usedPercent))
                    .frame(maxWidth: .infinity)

                Text(formatPercent(window.usedPercent))
                    .font(.caption.monospaced())
                    .foregroundStyle(percentColor(window.usedPercent))
                    .frame(width: 40, alignment: .trailing)

                if let reset = window.resetAfterSeconds {
                    Text("↻\(formatDuration(seconds: reset))")
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                        .frame(width: 56, alignment: .trailing)
                }
            }
        }
    }
}
