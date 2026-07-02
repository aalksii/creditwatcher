import CryptoKit
import Foundation
import Security

struct ClaudeCredentials {
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date?
    let subscriptionType: String?
    let scopes: [String]?
    let sourcePath: String
    let managedByClaudeCode: Bool
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
    static let keychainImportAllowedKey = "claudeKeychainImportAllowed"
    static let keychainImportSkippedKey = "claudeKeychainImportSkipped"

    static var canUseKeychainFallback: Bool {
        UserDefaults.standard.bool(forKey: keychainImportAllowedKey)
    }

    /// True when any file-based Claude credential source exists.
    static var fileCredentialsExist: Bool {
        if let env = ProcessInfo.processInfo.environment["CLAUDE_CODE_OAUTH_TOKEN"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !env.isEmpty {
            return true
        }
        if FileManager.default.fileExists(atPath: claudeCredsPath.path) { return true }
        if FileManager.default.fileExists(atPath: copyPath.path) { return true }
        return false
    }

    static func loadCandidates(includeKeychain: Bool = false, allowKeychainPrompt: Bool = false) -> [ClaudeCredentials] {
        var candidates: [ClaudeCredentials] = []

        if let env = ProcessInfo.processInfo.environment["CLAUDE_CODE_OAUTH_TOKEN"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !env.isEmpty,
           let c = parse(json: "{\"claudeAiOauth\":{\"accessToken\":\"\(env)\"}}", path: "CLAUDE_CODE_OAUTH_TOKEN", managed: true) {
            candidates.append(c)
        }

        if let c = loadFile(claudeCredsPath, managed: true) {
            candidates.append(c)
        }

        if let c = loadFile(copyPath, managed: false) { candidates.append(c) }
        if includeKeychain, let c = loadKeychainCandidate(allowUserPrompt: allowKeychainPrompt) {
            candidates.append(c)
        }

        return candidates.sorted { a, b in
            expiryMs(a) > expiryMs(b)
        }
    }

    static func forgetCopy() {
        try? FileManager.default.removeItem(at: copyPath)
    }

    static func importAvailableCredentials() throws {
        if let existing = loadCandidates().first {
            saveCopy(existing)
            return
        }

        if let creds = loadKeychainCandidate(allowUserPrompt: true) {
            saveCopy(creds)
            return
        }

        throw QuotaError.auth("No Claude Code credentials found. Sign in to Claude Code, then click Sign In again.")
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

    private static func loadKeychainCandidate(allowUserPrompt: Bool) -> ClaudeCredentials? {
        guard let keychain = readKeychainCredentials(allowUserPrompt: allowUserPrompt) else {
            return nil
        }
        return parse(
            json: keychain.raw,
            path: "macOS Keychain (\(keychain.service))",
            managed: false
        )
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
            throw QuotaError.auth("Claude session expired. Sign in again from Settings.")
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
        var oauth: [String: Any] = [
            "accessToken": creds.accessToken,
            "refreshToken": creds.refreshToken,
        ]
        if let expiresAt = creds.expiresAt {
            oauth["expiresAt"] = Int(expiresAt.timeIntervalSince1970 * 1000)
        }
        if let subscriptionType = creds.subscriptionType {
            oauth["subscriptionType"] = subscriptionType
        }
        if let scopes = creds.scopes {
            oauth["scopes"] = scopes
        }
        let body = try? JSONSerialization.data(withJSONObject: ["claudeAiOauth": oauth], options: [.prettyPrinted])
        try? body?.write(to: url, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    private static func readKeychainCredentials(allowUserPrompt: Bool) -> (raw: String, service: String)? {
        for service in keychainServiceNames() {
            if let raw = readKeychainService(service, allowUserPrompt: allowUserPrompt) {
                return (raw, service)
            }
        }
        return nil
    }

    private static func keychainServiceNames() -> [String] {
        let configDir = ProcessInfo.processInfo.environment["CLAUDE_CONFIG_DIR"]
            .map { ($0 as NSString).expandingTildeInPath }
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude").path
        let digest = SHA256.hash(data: Data(configDir.utf8))
        let hash = digest.map { String(format: "%02x", $0) }.joined().prefix(16)
        return [
            "Claude Code-credentials-\(hash)",
            "Claude Code-credentials",
        ]
    }

    private static func readKeychainService(_ service: String, allowUserPrompt: Bool) -> String? {
        let username = NSUserName()
        var baseQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        if !allowUserPrompt {
            baseQuery[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUISkip
        }

        var query = baseQuery
        query[kSecAttrAccount as String] = username
        if let raw = readKeychainString(query) { return raw }
        return readKeychainString(baseQuery)
    }

    private static func readKeychainString(_ query: [String: Any]) -> String? {
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess,
              let data = item as? Data,
              let raw = String(data: data, encoding: .utf8),
              !raw.isEmpty
        else {
            return nil
        }
        return raw
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
        let candidates = ClaudeAuth.loadCandidates(
            includeKeychain: ClaudeAuth.canUseKeychainFallback,
            allowKeychainPrompt: false
        )
        guard !candidates.isEmpty else {
            return ProviderQuotaData(
                providerId: "claude",
                status: "not_connected",
                loginHint: "Open Settings and import your Claude Code sign-in."
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

            var refreshedDuringAttempt = false
            do {
                if ClaudeAuth.tokenNeedsRefresh(candidate), !candidate.refreshToken.isEmpty {
                    candidate = try await refreshedCandidate(candidate)
                    refreshedDuringAttempt = true
                }

                return try await requestAndPersistUsage(candidate)
            } catch let error as QuotaError {
                if case .http(let status, _) = error,
                   (status == 401 || status == 403),
                   !refreshedDuringAttempt,
                   !candidate.refreshToken.isEmpty {
                    do {
                        let refreshed = try await refreshedCandidate(candidate)
                        return try await requestAndPersistUsage(refreshed)
                    } catch {
                        lastAuthError = error
                        continue
                    }
                }
                if case .http(let status, _) = error,
                   status == 401 || status == 403 || status == 429 {
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

    private static func refreshedCandidate(_ candidate: ClaudeCredentials) async throws -> ClaudeCredentials {
        let refreshed = try await ClaudeAuth.refresh(candidate.refreshToken)
        let updated = ClaudeCredentials(
            accessToken: refreshed.access,
            refreshToken: refreshed.refresh,
            expiresAt: refreshed.expiresAt,
            subscriptionType: candidate.subscriptionType,
            scopes: candidate.scopes,
            sourcePath: candidate.sourcePath,
            managedByClaudeCode: candidate.managedByClaudeCode
        )
        ClaudeAuth.saveCopy(updated)
        return updated
    }

    private static func requestAndPersistUsage(_ candidate: ClaudeCredentials) async throws -> ProviderQuotaData {
        let snapshot = try await requestUsage(candidate)
        QuotaCache.markUsageFetched(provider: .claude)
        var result = snapshot
        result.status = "ok"
        result.providerId = "claude"
        result.authSource = candidate.sourcePath
        result.lastUpdated = ISO8601DateFormatter().string(from: Date())
        if candidate.sourcePath.hasPrefix("macOS Keychain") {
            ClaudeAuth.saveCopy(candidate)
        }
        QuotaCache.saveProviderCache(.claude, data: result)
        return result
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
