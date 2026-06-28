import Foundation

enum NativeQuotaService {
    static let refreshCooldown: TimeInterval = 60

    static func fetchQuota(force: Bool = false) async -> QuotaResponse {
        async let codex = CodexProvider.fetch(force: force)
        async let claude = ClaudeProvider.fetch(force: force)
        async let cursor = CursorProvider.fetch(force: force)

        let providers = await [codex, claude, cursor].map { toQuotaProvider($0) }

        return QuotaResponse(
            providers: providers,
            updatedAt: ISO8601DateFormatter().string(from: Date())
        )
    }

    static func handleProviderError(_ error: Error, provider: ProviderID) -> ProviderQuotaData {
        if case QuotaError.cooldown(let seconds, _) = error {
            if var cached = QuotaCache.loadProviderCache(provider) {
                cached.status = "cooldown"
                cached.providerId = provider.rawValue
                cached.cached = true
                cached.secondsUntilRefresh = seconds
                cached.nextRefreshAt = ISO8601DateFormatter().string(
                    from: Date().addingTimeInterval(TimeInterval(seconds))
                )
                return cached
            }
            return ProviderQuotaData(
                providerId: provider.rawValue,
                status: "cooldown",
                error: error.localizedDescription,
                secondsUntilRefresh: seconds,
                nextRefreshAt: ISO8601DateFormatter().string(
                    from: Date().addingTimeInterval(TimeInterval(seconds))
                )
            )
        }

        let message = error.localizedDescription
        let classified = classifyHttpError(message, provider: provider)

        if var cached = QuotaCache.loadProviderCache(provider) {
            cached.status = "error"
            cached.providerId = provider.rawValue
            cached.cached = true
            cached.error = classified
            cached.loginHint = loginHint(for: provider)
            return cached
        }

        return ProviderQuotaData(
            providerId: provider.rawValue,
            status: "error",
            error: classified,
            loginHint: loginHint(for: provider)
        )
    }

    private static func classifyHttpError(_ message: String, provider: ProviderID) -> String {
        if message.contains("(401)") || message.contains("(403)") {
            return "Authentication failed. Sign in with the official CLI."
        }
        if message.contains("(429)") {
            if provider == .claude {
                return "Rate limited or session expired. Sign in with Claude Code, then refresh."
            }
            return "Rate limited. Try again later."
        }
        if provider == .claude,
           message.localizedCaseInsensitiveContains("authentication") ||
           message.localizedCaseInsensitiveContains("session expired") {
            return message
        }
        return message
    }

    private static func loginHint(for provider: ProviderID) -> String {
        switch provider {
        case .codex: return "Run `codex login` or `creditwatcher login codex`"
        case .claude: return "Run `claude` to sign in, or `creditwatcher login claude`"
        case .cursor: return "Sign in to the Cursor app, or `creditwatcher login cursor`"
        }
    }

    private static func toQuotaProvider(_ data: ProviderQuotaData) -> QuotaProvider {
        QuotaProvider(
            id: data.providerId,
            status: data.status,
            plan: data.plan,
            account: data.account,
            windows: data.windows,
            credits: data.credits,
            warnings: data.warnings,
            error: data.error,
            loginHint: data.loginHint,
            cached: data.cached,
            secondsUntilRefresh: data.secondsUntilRefresh,
            nextRefreshAt: data.nextRefreshAt,
            lastUpdated: data.lastUpdated
        )
    }
}
