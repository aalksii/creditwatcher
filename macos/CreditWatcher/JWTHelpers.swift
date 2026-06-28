import Foundation

enum JWTHelpers {
    static func parsePayload(_ token: String) -> [String: Any]? {
        let parts = token.split(separator: ".")
        guard parts.count == 3 else { return nil }
        var base64 = String(parts[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let padding = 4 - base64.count % 4
        if padding < 4 { base64 += String(repeating: "=", count: padding) }
        guard let data = Data(base64Encoded: base64),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return json
    }

    static func expirationDate(_ token: String) -> Date? {
        guard let payload = parsePayload(token),
              let exp = payload["exp"] as? TimeInterval
        else { return nil }
        return Date(timeIntervalSince1970: exp)
    }

    static func isExpired(_ token: String, leewaySeconds: TimeInterval = 120) -> Bool {
        guard let exp = expirationDate(token) else { return false }
        return Date().addingTimeInterval(leewaySeconds) >= exp
    }

    static func chatGPTAccountId(from idToken: String) -> String? {
        guard let payload = parsePayload(idToken) else { return nil }
        if let id = payload["https://api.openai.com/auth.chatgpt_account_id"] as? String { return id }
        if let id = payload["chatgpt_account_id"] as? String { return id }
        return nil
    }

    static func stringClaim(_ token: String, key: String) -> String? {
        guard let payload = parsePayload(token) else { return nil }
        return payload[key] as? String
    }
}
