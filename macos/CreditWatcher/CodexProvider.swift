import Foundation

struct CodexCredentials {
    let accessToken: String
    let refreshToken: String
    let accountId: String
    let idToken: String
    let sourcePath: String
}

enum CodexAuth {
    private static var codexAuthPath: URL {
        let codexHome = ProcessInfo.processInfo.environment["CODEX_HOME"]
            .map { URL(fileURLWithPath: ($0 as NSString).expandingTildeInPath) }
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".codex")
        return codexHome.appendingPathComponent("auth.json")
    }

    private static var creditwatcherAuthPath: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".creditwatcher/auth.json")
    }

    static func load() -> CodexCredentials? {
        for url in [codexAuthPath, creditwatcherAuthPath] {
            if let creds = load(from: url) { return creds }
        }
        return nil
    }

    static func forgetCopy() {
        try? FileManager.default.removeItem(at: creditwatcherAuthPath)
    }

    private static func load(from url: URL) -> CodexCredentials? {
        guard let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let tokens = json["tokens"] as? [String: Any],
              let access = tokens["access_token"] as? String,
              let refresh = tokens["refresh_token"] as? String,
              !access.isEmpty, !refresh.isEmpty
        else { return nil }

        let idToken = tokens["id_token"] as? String ?? ""
        let accountId = (tokens["account_id"] as? String)
            ?? JWTHelpers.chatGPTAccountId(from: idToken)
            ?? ""

        return CodexCredentials(
            accessToken: access,
            refreshToken: refresh,
            accountId: accountId,
            idToken: idToken,
            sourcePath: url.path
        )
    }

    static func ensureFresh(_ creds: CodexCredentials) async throws -> CodexCredentials {
        guard JWTHelpers.isExpired(creds.accessToken) else { return creds }

        let url = URL(string: "https://auth.openai.com/oauth/token")!
        let data = try await HTTPClient.postJSON(
            url: url,
            body: [
                "client_id": "app_EMoamEEZ73f0CkXaXp7hrann",
                "grant_type": "refresh_token",
                "refresh_token": creds.refreshToken,
            ]
        )

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let access = json["access_token"] as? String
        else { throw QuotaError.auth("Codex token refresh failed") }

        let idToken = json["id_token"] as? String ?? creds.idToken
        let accountId = JWTHelpers.chatGPTAccountId(from: idToken) ?? creds.accountId

        return CodexCredentials(
            accessToken: access,
            refreshToken: json["refresh_token"] as? String ?? creds.refreshToken,
            accountId: accountId,
            idToken: idToken,
            sourcePath: creds.sourcePath
        )
    }
}

enum CodexProvider {
    static func fetch(force: Bool) async -> ProviderQuotaData {
        guard let creds = CodexAuth.load() else {
            return notConnected()
        }

        if !force {
            do {
                try QuotaCache.checkUsageCooldown(provider: .codex)
            } catch {
                return NativeQuotaService.handleProviderError(error, provider: .codex)
            }
        }

        do {
            let fresh = try await CodexAuth.ensureFresh(creds)
            var snapshot = try await requestUsage(creds: fresh)
            QuotaCache.markUsageFetched(provider: .codex)
            snapshot.status = "ok"
            snapshot.providerId = "codex"
            snapshot.authSource = fresh.sourcePath
            snapshot.lastUpdated = ISO8601DateFormatter().string(from: Date())
            QuotaCache.saveProviderCache(.codex, data: snapshot)
            return snapshot
        } catch {
            return NativeQuotaService.handleProviderError(error, provider: .codex)
        }
    }

    private static func notConnected() -> ProviderQuotaData {
        ProviderQuotaData(
            providerId: "codex",
            status: "not_connected",
            loginHint: "Run `codex login` or `creditwatcher login codex`"
        )
    }

    private static func requestUsage(creds: CodexCredentials) async throws -> ProviderQuotaData {
        let url = URL(string: "https://chatgpt.com/backend-api/wham/usage")!
        var headers = [
            "Authorization": "Bearer \(creds.accessToken)",
            "Accept": "application/json",
            "User-Agent": "creditwatcher/0.1.0",
        ]
        if !creds.accountId.isEmpty {
            headers["ChatGPT-Account-Id"] = creds.accountId
        }

        let data = try await HTTPClient.get(url: url, headers: headers)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw QuotaError.auth("Invalid Codex usage JSON")
        }

        var windows: [QuotaWindow] = []
        if let rateLimit = json["rate_limit"] as? [String: Any] {
            if let primary = rateLimit["primary_window"] as? [String: Any] {
                windows.append(parseWindow(primary, label: windowLabel(primary["limit_window_seconds"] as? Int, defaultSeconds: 18000)))
            }
            if let secondary = rateLimit["secondary_window"] as? [String: Any] {
                windows.append(parseWindow(secondary, label: windowLabel(secondary["limit_window_seconds"] as? Int, defaultSeconds: 604800)))
            }
        }

        var credits: ProviderCredits?
        if let c = json["credits"] as? [String: Any] {
            credits = ProviderCredits(
                balance: c["balance"] as? String,
                unlimited: c["unlimited"] as? Bool,
                hasCredits: c["has_credits"] as? Bool
            )
        }

        var warnings: [String] = []
        if (json["rate_limit"] as? [String: Any])?["limit_reached"] as? Bool == true {
            warnings.append("Rate limit reached")
        }
        if (json["spend_control"] as? [String: Any])?["reached"] as? Bool == true {
            warnings.append("Spend control limit reached")
        }

        return ProviderQuotaData(
            providerId: "codex",
            status: "ok",
            plan: json["plan_type"] as? String,
            account: json["email"] as? String,
            windows: windows,
            credits: credits,
            warnings: warnings
        )
    }

    private static func parseWindow(_ w: [String: Any], label: String) -> QuotaWindow {
        let used = (w["used_percent"] as? Double) ?? (w["used_percent"] as? Int).map(Double.init) ?? 0
        let resetAfter = w["reset_after_seconds"] as? Int
        var resetAt: String?
        if let ts = w["reset_at"] as? TimeInterval {
            resetAt = ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: ts))
        } else if let ts = w["reset_at"] as? Int {
            resetAt = ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: TimeInterval(ts)))
        }
        return QuotaWindow(
            label: label,
            usedPercent: used,
            remainingPercent: max(0, 100 - used),
            resetAt: resetAt,
            resetAfterSeconds: resetAfter
        )
    }

    private static func windowLabel(_ seconds: Int?, defaultSeconds: Int) -> String {
        let s = seconds ?? defaultSeconds
        if s <= 20_000 { return "5-hour" }
        if s >= 500_000 { return "weekly" }
        let hours = s / 3600
        return "\(hours)-hour"
    }
}
