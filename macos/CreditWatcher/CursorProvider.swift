import Foundation
import SQLite3

struct CursorCredentials {
    let sessionToken: String
    let sourcePath: String
}

enum CursorAuth {
    private static let accessTokenKey = "cursorAuth/accessToken"
    private static let sessionCookie = "WorkosCursorSessionToken"

    private static var stateDbPath: URL {
        if let override = ProcessInfo.processInfo.environment["CURSOR_STATE_DB"], !override.isEmpty {
            return URL(fileURLWithPath: (override as NSString).expandingTildeInPath)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Cursor/User/globalStorage/state.vscdb")
    }

    private static var copyPath: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".creditwatcher/cursor-auth.json")
    }

    static func loadCandidates() -> [CursorCredentials] {
        var candidates: [CursorCredentials] = []
        var seen = Set<String>()

        func add(_ c: CursorCredentials?) {
            guard let c, !seen.contains(c.sessionToken) else { return }
            seen.insert(c.sessionToken)
            candidates.append(c)
        }

        if let env = ProcessInfo.processInfo.environment["CURSOR_SESSION_TOKEN"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !env.isEmpty,
           let token = normalizeSessionToken(env) {
            add(CursorCredentials(sessionToken: token, sourcePath: "CURSOR_SESSION_TOKEN"))
        }

        add(loadFromSQLite())
        add(loadFromCopy())

        return candidates
    }

    private static func loadFromCopy() -> CursorCredentials? {
        guard let data = try? Data(contentsOf: copyPath),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let raw = json["sessionToken"] as? String,
              let token = normalizeSessionToken(raw)
        else { return nil }
        return CursorCredentials(sessionToken: token, sourcePath: copyPath.path)
    }

    private static func loadFromSQLite() -> CursorCredentials? {
        let path = stateDbPath.path
        guard FileManager.default.fileExists(atPath: path) else { return nil }

        var db: OpaquePointer?
        guard sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let db else {
            return nil
        }
        defer { sqlite3_close(db) }

        let sql = "SELECT value FROM ItemTable WHERE key = ?"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else {
            return nil
        }
        defer { sqlite3_finalize(stmt) }

        sqlite3_bind_text(stmt, 1, accessTokenKey, -1, SQLITE_TRANSIENT)

        guard sqlite3_step(stmt) == SQLITE_ROW,
              let cString = sqlite3_column_text(stmt, 0)
        else { return nil }

        let raw = String(cString: cString)
        guard let token = normalizeSessionToken(raw) else { return nil }
        return CursorCredentials(sessionToken: token, sourcePath: path)
    }

    static func normalizeSessionToken(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        if trimmed.contains("::") || trimmed.lowercased().contains("%3a%3a") {
            return trimmed.replacingOccurrences(of: "%3A%3A", with: "::", options: .caseInsensitive)
        }

        let jwt = trimmed.hasPrefix("Bearer ") ? String(trimmed.dropFirst(7)) : trimmed
        let sub = JWTHelpers.stringClaim(jwt, key: "sub")
            ?? JWTHelpers.stringClaim(jwt, key: "user_id")
        if let sub { return "\(sub)::\(jwt)" }
        return trimmed
    }
}

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

enum CursorProvider {
    private static let usageURL = URL(string: "https://cursor.com/api/usage-summary")!
    private static let authURL = URL(string: "https://cursor.com/api/auth/me")!

    static func fetch(force: Bool) async -> ProviderQuotaData {
        let candidates = CursorAuth.loadCandidates()
        guard !candidates.isEmpty else {
            return ProviderQuotaData(
                providerId: "cursor",
                status: "not_connected",
                loginHint: "Sign in to the Cursor app, or run `creditwatcher login cursor`"
            )
        }

        if !force {
            do {
                try QuotaCache.checkUsageCooldown(provider: .cursor)
            } catch {
                return NativeQuotaService.handleProviderError(error, provider: .cursor)
            }
        }

        var lastAuthError: Error?

        for candidate in candidates {
            do {
                let snapshot = try await requestUsage(candidate)
                QuotaCache.markUsageFetched(provider: .cursor)
                var result = snapshot
                result.status = "ok"
                result.providerId = "cursor"
                result.authSource = candidate.sourcePath
                result.lastUpdated = ISO8601DateFormatter().string(from: Date())
                QuotaCache.saveProviderCache(.cursor, data: result)
                return result
            } catch let error as QuotaError {
                if case .http(let status, _) = error, status == 401 || status == 403 {
                    lastAuthError = error
                    continue
                }
                return NativeQuotaService.handleProviderError(error, provider: .cursor)
            } catch {
                return NativeQuotaService.handleProviderError(error, provider: .cursor)
            }
        }

        return NativeQuotaService.handleProviderError(
            lastAuthError ?? QuotaError.auth("Cursor authentication failed."),
            provider: .cursor
        )
    }

    private static func requestUsage(_ creds: CursorCredentials) async throws -> ProviderQuotaData {
        let cookies = ["WorkosCursorSessionToken": creds.sessionToken]

        async let summaryData = HTTPClient.get(url: usageURL, cookies: cookies)
        async let identityData: Data? = try? await HTTPClient.get(url: authURL, cookies: cookies)

        let summaryRaw = try await summaryData
        let identityRaw = await identityData

        guard let summary = try JSONSerialization.jsonObject(with: summaryRaw) as? [String: Any] else {
            throw QuotaError.auth("Invalid Cursor usage JSON")
        }

        var email: String?
        if let identityRaw,
           let identity = try? JSONSerialization.jsonObject(with: identityRaw) as? [String: Any] {
            email = identity["email"] as? String
        }

        let plan = formatPlanName(summary["membershipType"] as? String)
        let cycleEnd = (summary["billingCycleEnd"] as? String).flatMap { ISO8601DateFormatter().date(from: $0) }

        var windows: [QuotaWindow] = []
        var warnings: [String] = []

        if let individual = summary["individualUsage"] as? [String: Any],
           let usagePlan = individual["plan"] as? [String: Any],
           usagePlan["enabled"] as? Bool != false {

            let usedPercent = doubleValue(usagePlan["totalPercentUsed"])
                ?? percentFromUsedLimit(used: usagePlan["used"], limit: usagePlan["limit"])

            var detail: String?
            if let used = usagePlan["used"], let limit = usagePlan["limit"] {
                detail = "\(used)/\(limit)"
            }

            windows.append(makeWindow(label: "included", usedPercent: usedPercent, detail: detail, cycleEnd: cycleEnd))

            if let api = doubleValue(usagePlan["apiPercentUsed"]),
               Int(api.rounded()) != Int(usedPercent.rounded()) {
                windows.append(makeWindow(label: "API", usedPercent: api, cycleEnd: cycleEnd))
            }

            if let auto = doubleValue(usagePlan["autoPercentUsed"]),
               auto > 0, Int(auto.rounded()) != Int(usedPercent.rounded()) {
                windows.append(makeWindow(label: "auto", usedPercent: auto, cycleEnd: cycleEnd))
            }
        }

        if let onDemand = (summary["individualUsage"] as? [String: Any])?["onDemand"] as? [String: Any],
           onDemand["enabled"] as? Bool == true {
            let usedCents = (onDemand["used"] as? Int) ?? 0
            let limit = onDemand["limit"] as? Int
            var usedPercent = 0.0
            if let limit, limit > 0 { usedPercent = Double(usedCents) / Double(limit) * 100 }
            let detail = limit != nil
                ? String(format: "$%.2f / $%.2f", Double(usedCents) / 100, Double(limit!) / 100)
                : String(format: "$%.2f", Double(usedCents) / 100)
            windows.append(makeWindow(label: "on-demand", usedPercent: usedPercent, detail: detail, cycleEnd: cycleEnd))
        }

        if let msg = summary["autoModelSelectedDisplayMessage"] as? String, msg.contains("100%") {
            warnings.append(msg)
        }
        if let msg = summary["namedModelSelectedDisplayMessage"] as? String, msg.contains("100%") {
            warnings.append(msg)
        }

        return ProviderQuotaData(
            providerId: "cursor",
            status: "ok",
            plan: plan,
            account: email,
            windows: windows,
            warnings: warnings
        )
    }

    private static func doubleValue(_ value: Any?) -> Double? {
        if let d = value as? Double { return d }
        if let i = value as? Int { return Double(i) }
        return nil
    }

    private static func percentFromUsedLimit(used: Any?, limit: Any?) -> Double {
        let u = doubleValue(used) ?? 0
        let l = doubleValue(limit) ?? 0
        guard l > 0 else { return 0 }
        return Double(u) / Double(l) * 100
    }

    private static func makeWindow(label: String, usedPercent: Double, detail: String? = nil, cycleEnd: Date?) -> QuotaWindow {
        var resetAfter: Int?
        if let cycleEnd { resetAfter = max(0, Int(cycleEnd.timeIntervalSinceNow)) }
        return QuotaWindow(
            label: label,
            usedPercent: usedPercent,
            remainingPercent: max(0, 100 - usedPercent),
            resetAt: cycleEnd.map { ISO8601DateFormatter().string(from: $0) },
            resetAfterSeconds: resetAfter
        )
    }

    private static func formatPlanName(_ raw: String?) -> String {
        guard let raw, !raw.isEmpty else { return "unknown" }
        return raw.split(separator: "_")
            .map { $0.prefix(1).uppercased() + $0.dropFirst().lowercased() }
            .joined(separator: " ")
    }
}
