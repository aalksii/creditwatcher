import AppKit
import CryptoKit
import Foundation
import Network
import Security

enum ProviderAuthService {
    static func signIn(_ provider: ProviderID) async throws {
        switch provider {
        case .codex:
            _ = try await CodexAuth.login()
        case .claude:
            try ClaudeAuth.importAvailableCredentials()
        case .cursor:
            guard !CursorAuth.loadCandidates().isEmpty else {
                NSWorkspace.shared.open(URL(string: "cursor://")!)
                throw QuotaError.auth("Sign in to Cursor, then click Sign In again.")
            }
        }
    }
}

enum CodexOAuth {
    static let clientId = "app_EMoamEEZ73f0CkXaXp7hrann"
    static let issuer = "https://auth.openai.com"
    static let scope = "openid profile email offline_access api.connectors.read api.connectors.invoke"
    static let redirectPort: UInt16 = 1455
    static let redirectPath = "/auth/callback"
    static let userAgent = "creditwatcher/0.1.0"

    static var redirectURI: String {
        "http://localhost:\(redirectPort)\(redirectPath)"
    }

    static func authorizeURL(challenge: String, state: String) throws -> URL {
        var components = URLComponents(string: "\(issuer)/oauth/authorize")!
        components.queryItems = [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "scope", value: scope),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "id_token_add_organizations", value: "true"),
            URLQueryItem(name: "codex_cli_simplified_flow", value: "true"),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "originator", value: "creditwatcher"),
        ]
        guard let url = components.url else {
            throw QuotaError.auth("Could not build Codex sign-in URL.")
        }
        return url
    }
}

final class OAuthCallbackServer: @unchecked Sendable {
    private let expectedState: String
    private let path: String
    private let port: UInt16
    private let queue = DispatchQueue(label: "CreditWatcher.OAuthCallbackServer")
    private var listener: NWListener?
    private var continuation: CheckedContinuation<String, Error>?
    private var readyContinuation: CheckedContinuation<Void, Error>?
    private var isReady = false
    private var isFinished = false

    init(expectedState: String, path: String, port: UInt16) {
        self.expectedState = expectedState
        self.path = path
        self.port = port
    }

    func awaitCode(timeout: TimeInterval = 300) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            queue.async {
                self.continuation = continuation
                self.start(timeout: timeout)
            }
        }
    }

    func waitUntilReady() async throws {
        try await withCheckedThrowingContinuation { continuation in
            queue.async {
                if self.isReady {
                    continuation.resume()
                } else if self.isFinished {
                    continuation.resume(throwing: QuotaError.auth("OAuth callback server stopped before it was ready."))
                } else {
                    self.readyContinuation = continuation
                }
            }
        }
    }

    private func start(timeout: TimeInterval) {
        do {
            guard let endpointPort = NWEndpoint.Port(rawValue: port) else {
                throw QuotaError.auth("Invalid OAuth callback port.")
            }
            let listener = try NWListener(using: .tcp, on: endpointPort)
            listener.newConnectionHandler = { [weak self] connection in
                self?.handle(connection)
            }
            listener.stateUpdateHandler = { [weak self] state in
                self?.queue.async {
                    switch state {
                    case .ready:
                        self?.markReady()
                    case .failed(let error):
                        let authError = QuotaError.auth("OAuth callback server failed: \(error.localizedDescription)")
                        self?.readyContinuation?.resume(throwing: authError)
                        self?.readyContinuation = nil
                        self?.finish(.failure(authError))
                    default:
                        break
                    }
                }
            }
            self.listener = listener
            listener.start(queue: queue)

            queue.asyncAfter(deadline: .now() + timeout) { [weak self] in
                self?.finish(.failure(QuotaError.auth("OAuth sign-in timed out.")))
            }
        } catch {
            finish(.failure(error))
        }
    }

    private func handle(_ connection: NWConnection) {
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, _, _ in
            guard let self else {
                connection.cancel()
                return
            }

            let request = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            let result = self.parseCode(from: request)
            self.sendResponse(for: result, on: connection)

            switch result {
            case .success(let code):
                self.finish(.success(code))
            case .failure(let error):
                self.finish(.failure(error))
            }
        }
    }

    private func parseCode(from request: String) -> Result<String, Error> {
        guard let requestLine = request.split(separator: "\r\n", maxSplits: 1).first else {
            return .failure(QuotaError.auth("Invalid OAuth callback."))
        }

        let parts = requestLine.split(separator: " ")
        guard parts.count >= 2 else {
            return .failure(QuotaError.auth("Invalid OAuth callback."))
        }

        let target = String(parts[1])
        guard let url = URL(string: "http://localhost:\(port)\(target)"),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.path == path
        else {
            return .failure(QuotaError.auth("Unexpected OAuth callback path."))
        }

        let query = components.queryItems ?? []
        if let error = query.first(where: { $0.name == "error" })?.value {
            let detail = query.first(where: { $0.name == "error_description" })?.value ?? error
            return .failure(QuotaError.auth("OAuth error: \(detail)"))
        }
        guard query.first(where: { $0.name == "state" })?.value == expectedState else {
            return .failure(QuotaError.auth("OAuth state mismatch."))
        }
        guard let code = query.first(where: { $0.name == "code" })?.value, !code.isEmpty else {
            return .failure(QuotaError.auth("OAuth callback did not include an authorization code."))
        }
        return .success(code)
    }

    private func sendResponse(for result: Result<String, Error>, on connection: NWConnection) {
        let body: String
        switch result {
        case .success:
            body = "<!doctype html><html><body><h2>Signed in</h2><p>You can close this tab and return to CreditWatcher.</p></body></html>"
        case .failure(let error):
            body = "<!doctype html><html><body><h2>Login failed</h2><p>\(htmlEscape(error.localizedDescription))</p></body></html>"
        }
        let response = """
        HTTP/1.1 200 OK\r
        Content-Type: text/html; charset=utf-8\r
        Content-Length: \(body.utf8.count)\r
        Connection: close\r
        \r
        \(body)
        """
        connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private func finish(_ result: Result<String, Error>) {
        guard !isFinished else { return }
        isFinished = true
        if !isReady {
            readyContinuation?.resume(throwing: QuotaError.auth("OAuth callback server stopped before it was ready."))
            readyContinuation = nil
        }
        listener?.cancel()
        listener = nil
        guard let continuation else { return }
        self.continuation = nil
        continuation.resume(with: result)
    }

    private func markReady() {
        guard !isReady else { return }
        isReady = true
        readyContinuation?.resume()
        readyContinuation = nil
    }

    private func htmlEscape(_ text: String) -> String {
        text
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }
}

enum OAuthHelpers {
    static func pkcePair() throws -> (verifier: String, challenge: String) {
        let verifier = try randomBase64URL(byteCount: 32)
        let digest = SHA256.hash(data: Data(verifier.utf8))
        let challenge = base64URL(Data(digest))
        return (verifier, challenge)
    }

    static func state() throws -> String {
        try randomBase64URL(byteCount: 16)
    }

    private static func randomBase64URL(byteCount: Int) throws -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else {
            throw QuotaError.auth("Could not generate secure OAuth random data.")
        }
        return base64URL(Data(bytes))
    }

    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func formBody(_ items: [URLQueryItem]) -> Data {
        var components = URLComponents()
        components.queryItems = items
        return Data((components.percentEncodedQuery ?? "").utf8)
    }
}
