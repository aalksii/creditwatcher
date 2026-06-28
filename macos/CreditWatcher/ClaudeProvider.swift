import Foundation
import Security
import CryptoKit

struct ClaudeCredentials {
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date?
    let subscriptionType: String?
    let scopes: [String]?
    let sourcePath: String
    let managedByClaudeCode: Bool
}

enum ClaudeKeychain {
    static func serviceNames() -> [String] {
        let configDir = (ProcessInfo.processInfo.environment["CLAUDE_CONFIG_DIR"]
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude").path)
            as NSString
        let expanded = configDir.expandingTildeInPath
        let fullHash = SHA256.hash(data: Data(expanded.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
            .prefix(16)
        return [
            "Claude Code-credentials-\(fullHash)",
            "Claude Code-credentials",
        ]
    }

    static func read() -> (raw: String, service: String)? {
        let username = NSUserName()
        for service in serviceNames() {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: username,
                kSecReturnData as String: true,
                kSecMatchLimit as String: kSecMatchLimitOne,
            ]
            var item: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &item)
            guard status == errSecSuccess,
                  let data = item as? Data,
                  let raw = String(data: data, encoding: .utf8),
                  !raw.isEmpty
            else { continue }
            return (raw, service)
        }
        return nil
    }
}

enum ClaudeAuth {
    private static var claudeCredsPath: URL {
        let dir = ProcessInfo.processInfo.environment["CLAUDE_CONFIG_DIR"]
            .map { URL(fileURLWithPath: ($0 as NSString).expandingTildeInPath) }
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude")
        return dir.appendingPathComponent(".credentials.json")
    }

    private static var copyPath: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".creditwatcher/claude-auth.json")
    }

    /// True when Claude Code's own credentials file exists (Keychain is not used in that case).
    static var officialCredentialsExist: Bool {
        FileManager.default.fileExists(atPath: claudeCredsPath.path)
    }

    static func loadCandidates() -> [ClaudeCredentials] {
        var candidates: [ClaudeCredentials] = []

        if let env = ProcessInfo.processInfo.environment["CLAUDE_CODE_OAUTH_TOKEN"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !env.isEmpty,
           let c = parse(json: "{\"claudeAiOauth\":{\"accessToken\":\"\(env)\"}}", path: "CLAUDE_CODE_OAUTH_TOKEN", managed: true) {
            candidates.append(c)
        }

        if let c = loadFile(claudeCredsPath, managed: true) {
            candidates.append(c)
        } else if let keychain = ClaudeKeychain.read(),
                  let c = parse(json: keychain.raw, path: "macOS Keychain (\(keychain.service))", managed: true) {
            candidates.append(c)
        }

        if let c = loadFile(copyPath, managed: false) { candidates.append(c) }

        return candidates.sorted { a, b in
            expiryMs(a) > expiryMs(b)
        }
    }

    private static func expiryMs(_ creds: ClaudeCredentials) -> TimeInterval {
        if let jwt = JWTHelpers.expirationDate(creds.accessToken) { return jwt.timeIntervalSince1970 }
        return creds.expiresAt?.timeIntervalSince1970 ?? 0
    }

    private static func loadFile(_ url: URL, managed: Bool) -> ClaudeCredentials? {
        guard let data = try? Data(contentsOf: url),
              let raw = String(data: data, encoding: .utf8)
        else { return nil }
        return parse(json: raw, path: url.path, managed: managed)
    }

    private static func parse(json: String, path: String, managed: Bool) -> ClaudeCredentials? {
        guard let data = json.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let oauth = root["claudeAiOauth"] as? [String: Any],
              let access = oauth["accessToken"] as? String,
              !access.isEmpty
        else { return nil }

        var expiresAt: Date?
        if let exp = oauth["expiresAt"] as? Double {
            expiresAt = exp > 1e12 ? Date(timeIntervalSince1970: exp / 1000) : Date(timeIntervalSince1970: exp)
        } else if let exp = oauth["expiresAt"] as? Int {
            let d = Double(exp)
            expiresAt = d > 1e12 ? Date(timeIntervalSince1970: d / 1000) : Date(timeIntervalSince1970: d)
        }

        return ClaudeCredentials(
            accessToken: access,
            refreshToken: oauth["refreshToken"] as? String ?? "",
            expiresAt: expiresAt,
            subscriptionType: oauth["subscriptionType"] as? String,
            scopes: oauth["scopes"] as? [String],
            sourcePath: path,
            managedByClaudeCode: managed
        )
    }

    static func tokenNeedsRefresh(_ creds: ClaudeCredentials) -> Bool {
        if JWTHelpers.isExpired(creds.accessToken, leewaySeconds: 300) { return true }
        guard let exp = creds.expiresAt else { return false }
        return Date().addingTimeInterval(300) >= exp
    }

    static func refresh(_ refreshToken: String) async throws -> (access: String, refresh: String, expiresAt: Date?) {
        guard !refreshToken.isEmpty else {
            throw QuotaError.auth("Claude session expired. Run `claude` to sign in again.")
        }

        let url = URL(string: "https://platform.claude.com/v1/oauth/token")!
        let data = try await HTTPClient.postJSON(
            url: url,
            body: [
                "grant_type": "refresh_token",
                "refresh_token": refreshToken,
                "client_id": "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
                "scope": "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
            ],
            headers: ["User-Agent": "claude-code/2.1.195"]
        )

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let access = json["access_token"] as? String
        else { throw QuotaError.auth("Claude token refresh failed") }

        var expiresAt: Date?
        if let expiresIn = json["expires_in"] as? Int {
            expiresAt = Date().addingTimeInterval(TimeInterval(expiresIn))
        } else {
            expiresAt = JWTHelpers.expirationDate(access)
        }

        return (
            access,
            json["refresh_token"] as? String ?? refreshToken,
            expiresAt
        )
    }

    static func saveCopy(_ creds: ClaudeCredentials) {
        let url = copyPath
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let oauth: [String: Any] = [
            "accessToken": creds.accessToken,
            "refreshToken": creds.refreshToken,
            "expiresAt": creds.expiresAt.map { Int($0.timeIntervalSince1970 * 1000) } as Any,
            "subscriptionType": creds.subscriptionType as Any,
            "scopes": creds.scopes as Any,
        ]
        let body = try? JSONSerialization.data(withJSONObject: ["claudeAiOauth": oauth], options: [.prettyPrinted])
        try? body?.write(to: url, options: .atomic)
    }
}

enum ClaudeProvider {
    private static let usageURL = URL(string: "https://api.anthropic.com/api/oauth/usage")!
    private static let displayOrder = ["five_hour", "seven_day", "seven_day_sonnet", "seven_day_opus"]
    private static let labels: [String: String] = [
        "five_hour": "5-hour",
        "seven_day": "7-day",
        "seven_day_sonnet": "7-day Sonnet",
        "seven_day_opus": "7-day Opus",
    ]

    static func fetch(force: Bool) async -> ProviderQuotaData {
        let candidates = ClaudeAuth.loadCandidates()
        guard !candidates.isEmpty else {
            return ProviderQuotaData(
                providerId: "claude",
                status: "not_connected",
                loginHint: "Run `claude` to sign in, or `creditwatcher login claude`"
            )
        }

        if !force {
            do {
                try QuotaCache.checkUsageCooldown(provider: .claude)
            } catch {
                return NativeQuotaService.handleProviderError(error, provider: .claude)
            }
        }

        var lastAuthError: Error?

        for var candidate in candidates {
            if let scopes = candidate.scopes, !scopes.isEmpty, !scopes.contains("user:profile") {
                continue
            }

            do {
                if ClaudeAuth.tokenNeedsRefresh(candidate), !candidate.refreshToken.isEmpty {
                    let refreshed = try await ClaudeAuth.refresh(candidate.refreshToken)
                    candidate = ClaudeCredentials(
                        accessToken: refreshed.access,
                        refreshToken: refreshed.refresh,
                        expiresAt: refreshed.expiresAt,
                        subscriptionType: candidate.subscriptionType,
                        scopes: candidate.scopes,
                        sourcePath: candidate.sourcePath,
                        managedByClaudeCode: candidate.managedByClaudeCode
                    )
                    ClaudeAuth.saveCopy(candidate)
                }

                let snapshot = try await requestUsage(candidate)
                QuotaCache.markUsageFetched(provider: .claude)
                var result = snapshot
                result.status = "ok"
                result.providerId = "claude"
                result.authSource = candidate.sourcePath
                result.lastUpdated = ISO8601DateFormatter().string(from: Date())
                QuotaCache.saveProviderCache(.claude, data: result)
                return result
            } catch let error as QuotaError {
                if case .http(let status, _) = error, status == 401 || status == 403 || status == 429 {
                    lastAuthError = error
                    continue
                }
                return NativeQuotaService.handleProviderError(error, provider: .claude)
            } catch {
                return NativeQuotaService.handleProviderError(error, provider: .claude)
            }
        }

        return NativeQuotaService.handleProviderError(
            lastAuthError ?? QuotaError.auth("Claude authentication failed for all credential sources."),
            provider: .claude
        )
    }

    private static func requestUsage(_ creds: ClaudeCredentials) async throws -> ProviderQuotaData {
        let data = try await HTTPClient.get(
            url: usageURL,
            headers: [
                "Authorization": "Bearer \(creds.accessToken)",
                "Accept": "application/json",
                "Content-Type": "application/json",
                "anthropic-beta": "oauth-2025-04-20",
                "User-Agent": "claude-code/2.1.195",
            ]
        )

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw QuotaError.auth("Invalid Claude usage JSON")
        }

        var windows: [QuotaWindow] = []
        for key in displayOrder {
            guard let entry = json[key] as? [String: Any],
                  entry["is_enabled"] as? Bool != false,
                  let util = (entry["utilization"] as? Double) ?? (entry["utilization"] as? Int).map(Double.init)
            else { continue }

            var resetAfter: Int?
            var resetAt: String?
            if let resets = entry["resets_at"] as? String,
               let date = ISO8601DateFormatter().date(from: resets) {
                resetAt = resets
                resetAfter = max(0, Int(date.timeIntervalSinceNow))
            }

            windows.append(QuotaWindow(
                label: labels[key] ?? key,
                usedPercent: util,
                remainingPercent: max(0, 100 - util),
                resetAt: resetAt,
                resetAfterSeconds: resetAfter
            ))
        }

        return ProviderQuotaData(
            providerId: "claude",
            status: "ok",
            plan: creds.subscriptionType,
            windows: windows,
            warnings: []
        )
    }
}
