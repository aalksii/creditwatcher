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
            signInHelp
        case "cooldown":
            if provider.windows.isEmpty {
                Text(provider.error ?? "On cooldown")
                    .font(.caption)
                    .foregroundStyle(.orange)
                signInHelp
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
            signInHelp
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
    private var signInHelp: some View {
        if let hint = provider.loginHint ?? defaultLoginHint {
            Text(hint)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var defaultLoginHint: String? {
        switch provider.id {
        case "codex":
            return "Sign in with Codex, then click Refresh."
        case "claude":
            if ClaudeAuth.fileCredentialsExist {
                return "Claude credentials found but usage could not be loaded. Re-import, then click Refresh."
            }
            return "Import Claude credentials. If needed, run `claude` first to sign in with Claude Code."
        case "cursor":
            return "Sign in to Cursor or import a session token, then click Refresh."
        default:
            return nil
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

                if let reset = resetAfterSeconds(for: window) {
                    Text("↻\(formatDuration(seconds: reset))")
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                        .frame(width: 56, alignment: .trailing)
                }
            }
        }
    }

    private func resetAfterSeconds(for window: QuotaWindow) -> Int? {
        if let resetAt = window.resetAt {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            var date = formatter.date(from: resetAt)
            if date == nil {
                formatter.formatOptions = [.withInternetDateTime]
                date = formatter.date(from: resetAt)
            }
            if let date {
                return max(0, Int(date.timeIntervalSinceNow))
            }
        }
        return window.resetAfterSeconds
    }
}
