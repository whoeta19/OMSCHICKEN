import Foundation

// MARK: - Конфигурация

enum API {
    static let baseURL = URL(string: "http://localhost:3000/api/v1")!
}

enum APIError: Error {
    case http(Int)
    case decoding
    case noToken
}

// MARK: - Хранилище токенов (в проде — Keychain)

@MainActor
final class TokenStore {
    static let shared = TokenStore()
    var accessToken: String?
    var refreshToken: String?
}

// MARK: - Клиент

actor APIClient {
    static let shared = APIClient()
    private let session = URLSession.shared
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()
    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .convertToSnakeCase
        return e
    }()

    func get<T: Decodable>(_ path: String, query: [String: String] = [:]) async throws -> T {
        var comps = URLComponents(url: API.baseURL.appending(path: path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty {
            comps.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        var req = URLRequest(url: comps.url!)
        await attachAuth(&req)
        return try await send(req)
    }

    func post<Body: Encodable, T: Decodable>(_ path: String, body: Body) async throws -> T {
        var req = URLRequest(url: API.baseURL.appending(path: path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try encoder.encode(body)
        await attachAuth(&req)
        return try await send(req)
    }

    func patch<T: Decodable>(_ path: String) async throws -> T {
        var req = URLRequest(url: API.baseURL.appending(path: path))
        req.httpMethod = "PATCH"
        await attachAuth(&req)
        return try await send(req)
    }

    // MARK: Private

    private func attachAuth(_ req: inout URLRequest) async {
        if let token = await TokenStore.shared.accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
    }

    private func send<T: Decodable>(_ req: URLRequest) async throws -> T {
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw APIError.http(-1) }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode) }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decoding
        }
    }
}
